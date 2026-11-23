# Publishing API (Phase 5)

How one prepared post is sent to many Facebook Pages and Instagram accounts, and the HTTP
API the web app uses for it.

> **Status (2026-11-23).** The engine is implemented and tested, and **verified against a
> real Redis server** (Memurai 4.1.2, Redis API 7.2.5) with the real BullMQ queue, real API
> and worker processes and MongoDB, in SIMULATED mode ([section 6](#6-redis)).
>
> **Real publishing (Phase 8, same day)** is implemented behind two deliberate switches
> ([section 7](#7-real-publishing)): the server must offer it (`PUBLISHING_MODE=live`) and an
> owner or admin must switch the workspace to live with their password. Simulation stays the
> default everywhere. The Facebook and Instagram adapters are tested against a simulated Meta
> only: **nothing has been sent to a real Facebook Page or Instagram account yet**, and the
> real-account checks in [section 7](#7-real-publishing) are still open.
>
> Added later the same day: draft and job visibility ([section 4](#4-permissions)),
> changing a scheduled time and a soonest-first list of scheduled jobs, the Scheduled tab
> and "Change time" on the Publishing screen, scheduling in "Publish a draft", and the
> composer's Publish button.

## 1. Concepts

| Thing       | What it is                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Draft       | A saved `ContentPackage` (see [COMPOSER_API_CONTRACT.md](COMPOSER_API_CONTRACT.md))               |
| Publish job | One request to send one draft to N accounts. Holds a frozen copy of the draft's content           |
| Destination | One account of a job (one Facebook Page or one Instagram account), with its own state and history |
| Queue       | BullMQ on Redis. An entry holds one destination id and nothing else                               |
| Worker      | Takes entries from the queue and publishes one destination at a time                              |
| Adapter     | The code that talks to one platform: Facebook Page, Instagram, or the simulated adapter           |

MongoDB is the source of truth. Redis only delivers "process destination X now". If Redis
loses its data, nothing is lost: the recovery sweep queues waiting destinations again.

### Modes

Set with `PUBLISHING_MODE` in `apps/api/.env`.

| Mode        | Behaviour                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`  | Default. Jobs cannot be created (`503 PUBLISHING_DISABLED`). No worker starts                                                                                                                         |
| `simulated` | Development only (refused when `NODE_ENV=production`). The whole engine runs; **nothing is sent to Meta**                                                                                             |
| `live`      | Real publishing is **available**. Each workspace still publishes in simulation until an owner or admin switches **that workspace** to live (with their password). See [section 7](#7-real-publishing) |

A simulated job is marked `simulated: true` everywhere, never gets an `externalPostId` or a
link, and is shown in the UI and the activity log as a simulation.

A job's mode is fixed when it is created: `LIVE` only when the server is `live` **and** the
workspace chose live (`effectivePublishingMode` in `packages/shared/src/publishing.js`),
otherwise `SIMULATED`. A simulated job can never reach Meta. A live job whose workspace or
server has since switched real publishing off is refused just before sending
(`LIVE_PUBLISHING_DISABLED`, nothing sent) and cannot be retried or rescheduled
(`409 MODE_CHANGED`); it is never quietly turned into a simulation.

### Destination states

```
SCHEDULED ─┐
QUEUED ────┼─► PROCESSING ─► PUBLISHED            (final)
RETRY_SCHEDULED ┘     │
      ▲               ├────► RETRY_SCHEDULED      (temporary failure, attempts left)
      └───────────────┘
                      └────► FAILED ──(person retries)──► QUEUED
SCHEDULED / QUEUED / RETRY_SCHEDULED ─► CANCELLED (final)
```

- Every move is one atomic database update that names the state it expects, so a move can
  happen only once. The legal moves are in `DESTINATION_TRANSITIONS`
  (`packages/shared/src/publishing.js`).
- A destination being processed cannot be cancelled.
- Only a person can move a `FAILED` destination back to `QUEUED`.

### Job status

Always derived from the destinations (`deriveJobStatus`), never set by hand.

| Status                | Meaning                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `SCHEDULED`           | Every destination still waiting is waiting for its scheduled time (others may be cancelled) |
| `QUEUED`              | Waiting for a worker; nothing has started                                                   |
| `PROCESSING`          | At least one destination has started, and at least one is not done                          |
| `PUBLISHED`           | Every destination was published                                                             |
| `PARTIALLY_PUBLISHED` | Some were published; the rest failed or were cancelled                                      |
| `FAILED`              | None was published and at least one failed                                                  |
| `CANCELLED`           | Every destination was cancelled                                                             |

`DRAFT` is the state of the content before a job exists (`ContentPackage.status`).

## 2. Guarantees

- **One destination failing never affects the others.** Each has its own record, attempts
  and error.
- **No duplicate jobs.** The client sends an `idempotencyKey` chosen once per "Publish"
  click. The same key returns the same job (`200`, `created: false`). A unique database
  index enforces it, also for requests that arrive at the same moment.
- **No duplicate destinations.** A unique partial index allows one _active_ destination per
  draft and account. A draft already published to an account is refused unless the request
  says `republish: true`.
- **No duplicate publishing.** A worker must claim a destination (waiting → `PROCESSING`,
  with a private lock token) before doing anything, and only the claimant can finish it.
  The same queue entry delivered twice, or two workers, publish once.
- **No blind repeats.** If the call that creates the post gets no answer, or a worker stops
  after handing the post over, the destination fails as `OUTCOME_UNKNOWN` / `INTERRUPTED` and
  is **not** retried automatically. A person must confirm the retry
  (`acknowledgeDuplicateRisk`). The hand-over is recorded (`sendingAt`) just before the
  platform is called: a worker that stopped _before_ it sent nothing, so that destination is
  queued again automatically. If the platform accepted the post but saving the result fails,
  saving is tried again; it is never published a second time.
- **Authorization is checked again at send time.** Just before sending, the worker checks
  that the member the send relies on (the job's creator, or whoever last retried or
  rescheduled it) is still a member, still has `content:publish` and may still use the
  account, and that the workspace still exists. Otherwise the destination fails as
  `AUTHOR_NOT_AUTHORIZED` (nothing sent, not retried automatically) and the activity log gets
  `publish_destination.blocked` with the reason. An admin's retry then relies on the admin.
- **Retries with exponential backoff** for temporary failures only: 30 s, 60 s, 120 s, …
  (`PUBLISHING_RETRY_BASE_SECONDS`, doubling, capped at 15 minutes, up to 20% jitter), at
  most `PUBLISHING_MAX_ATTEMPTS` attempts. A rate limit waits at least 10 minutes.
- **Tokens stay out of everything.** Queue entries hold a destination id only. The worker
  reads the account's encrypted token at the moment it publishes. Tokens are never stored
  on jobs or destinations, never logged, and never returned by the API.
- **Nothing is queued when Redis is down.** Creation answers `503 QUEUE_UNAVAILABLE` and
  writes nothing. There is no in-memory substitute for Redis.

## 3. Endpoints

All under `/api/v1/workspaces/:workspaceId`, with the usual error shape
`{ error: { code, message, requestId, details? } }`.

| Method | Path                                                      | Permission        | Notes                                            |
| ------ | --------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| GET    | `/publishing/status`                                      | `content:read`    | Mode, queue and worker health                    |
| GET    | `/publish-jobs/summary`                                   | `content:read`    | Job counts per status                            |
| GET    | `/publish-jobs?status=&order=&cursor=&limit=`             | `content:read`    | Newest first, or `order=scheduled`; `limit` ≤ 50 |
| GET    | `/publish-jobs/:jobId`                                    | `content:read`    | One job with its destinations                    |
| POST   | `/publish-jobs`                                           | `content:publish` | Create a job                                     |
| PATCH  | `/publish-jobs/:jobId/schedule`                           | `content:publish` | Moves a scheduled job to another time            |
| POST   | `/publish-jobs/:jobId/cancel`                             | `content:publish` | Cancels every destination that is still waiting  |
| POST   | `/publish-jobs/:jobId/destinations/:destinationId/cancel` | `content:publish` | Cancels one waiting destination                  |
| POST   | `/publish-jobs/:jobId/destinations/:destinationId/retry`  | `content:publish` | Retries one failed destination                   |

The public `GET /api/v1/health` only says whether the API and its database are up.
Server-wide queue counts and worker numbers are on `GET /api/v1/health/details`, which answers
only with `Authorization: Bearer <HEALTH_DETAILS_TOKEN>` (set in `apps/api/.env`; without it
the route does not exist).

### Create a job

```http
POST /api/v1/workspaces/:workspaceId/publish-jobs
```

```json
{
  "contentPackageId": "6b01…",
  "socialAccountIds": ["6b01…", "6b01…"],
  "idempotencyKey": "b0d7c1f4a9e24c0d9a3f5e6b7c8d9e0f",
  "scheduledAt": "2026-12-01T09:00:00+05:30",
  "republish": false
}
```

| Field              | Required | Notes                                                               |
| ------------------ | -------- | ------------------------------------------------------------------- |
| `contentPackageId` | yes      | A draft of this workspace                                           |
| `socialAccountIds` | no       | 1–100 accounts. Defaults to the accounts saved on the draft         |
| `idempotencyKey`   | yes      | 16–100 characters `A–Z a–z 0–9 _ -`. One key per publish action     |
| `scheduledAt`      | no       | A future date-time, at most 90 days ahead. Omit to publish now      |
| `republish`        | no       | `true` to send again to an account that already received this draft |

Answers:

| Status | Code                  | When                                                                                                     |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| 201    |                       | Created: `{ publishJob, created: true }`                                                                 |
| 200    |                       | Same `idempotencyKey` as an existing job: `{ publishJob, created: false }`                               |
| 403    | `FORBIDDEN`           | The member's role cannot publish                                                                         |
| 404    | `NOT_FOUND`           | The draft does not exist in this workspace                                                               |
| 409    | `CONFLICT`            | `details.reason`: `IN_PROGRESS`, `ALREADY_PUBLISHED` (with `details.accounts`), `IDEMPOTENCY_KEY_REUSED` |
| 422    | `VALIDATION_ERROR`    | `details.fields.socialAccountIds`, `.content` or `.scheduledAt`                                          |
| 503    | `PUBLISHING_DISABLED` | `PUBLISHING_MODE` is `disabled`                                                                          |
| 503    | `QUEUE_UNAVAILABLE`   | Redis is not configured or not reachable. Nothing was written                                            |

Checks at creation: account access, account readiness (active login, ready to publish),
verified media, platform rules (Instagram needs media, at most 10 files, caption ≤ 2,200
characters, at most 30 hashtags; Facebook needs text or media, and one video or images but
not both).

### Job and destination

```json
{
  "id": "6b01…",
  "status": "PARTIALLY_PUBLISHED",
  "mode": "SIMULATED",
  "simulated": true,
  "contentPackageId": "6b01…",
  "content": { "captionPreview": "Hello", "mediaCount": 1, "hasVideo": false },
  "counts": {
    "SCHEDULED": 0,
    "QUEUED": 0,
    "PROCESSING": 0,
    "RETRY_SCHEDULED": 0,
    "PUBLISHED": 1,
    "FAILED": 1,
    "CANCELLED": 0
  },
  "destinationCount": 2,
  "hiddenDestinationCount": 0,
  "scheduledAt": null,
  "createdBy": { "id": "6b01…", "name": "Olivia Owner" },
  "createdAt": "2026-11-21T10:15:22.848Z",
  "startedAt": "2026-11-21T10:15:22.875Z",
  "completedAt": "2026-11-21T10:15:22.941Z",
  "canCancel": false,
  "destinations": [
    {
      "id": "6b01…",
      "socialAccountId": "6b01…",
      "platform": "FACEBOOK_PAGE",
      "accountName": "Page 1",
      "accountUsername": null,
      "state": "FAILED",
      "simulated": true,
      "attemptCount": 1,
      "maxAttempts": 4,
      "scheduledAt": null,
      "nextAttemptAt": null,
      "queuedAt": "…",
      "processingAt": "…",
      "completedAt": "…",
      "externalPostId": null,
      "externalUrl": null,
      "error": {
        "code": "PLATFORM_REJECTED",
        "message": "Not accepted.",
        "retryable": false,
        "uncertain": false,
        "at": "…"
      },
      "warnings": [],
      "attempts": [
        {
          "number": 1,
          "startedAt": "…",
          "finishedAt": "…",
          "outcome": "FAILED",
          "errorCode": "PLATFORM_REJECTED",
          "errorMessage": "Not accepted."
        }
      ],
      "canRetry": true,
      "canCancel": false
    }
  ]
}
```

- `externalPostId` and `externalUrl` are always `null` for simulated jobs.
- `error.message` is written for people and is safe to show. Provider text is stripped of
  anything that looks like a credential and cut to 240 characters.
- `error.uncertain` is `true` for `OUTCOME_UNKNOWN` and `INTERRUPTED`: the post may exist.
  It is `false` for a destination stopped before sending (`INTERNAL_ERROR`, "stopped before
  anything was sent") and for `AUTHOR_NOT_AUTHORIZED`.
- `warnings`: `FIRST_COMMENT_NOT_SENT`, `HASHTAGS_NOT_SENT` (see limitations).
- A job is only returned to readers who may use every account it targets (section 4), so
  `destinations` lists all of them and `hiddenDestinationCount` is `0`. The field stays for
  compatibility.
- `canCancel` and `canReschedule` say what the reader may do now (`content:publish`, and for
  `canReschedule` at least one destination still in `SCHEDULED`).

Error codes of a destination (`PUBLISH_ERROR_CODES`): `ACCOUNT_REMOVED`,
`ACCOUNT_NEEDS_RECONNECT`, `ACCOUNT_NOT_READY`, `CONTENT_NOT_PUBLISHABLE`,
`MEDIA_UNAVAILABLE`, `MEDIA_NOT_PUBLIC`, `LIVE_PUBLISHING_DISABLED`, `PERMISSION_DENIED`,
`RATE_LIMITED`, `PLATFORM_UNAVAILABLE`, `PLATFORM_REJECTED`, `OUTCOME_UNKNOWN`,
`INTERRUPTED`, `AUTHOR_NOT_AUTHORIZED`, `INTERNAL_ERROR`.

### Cancel and retry

- **Cancel job** cancels every destination in `SCHEDULED`, `QUEUED` or `RETRY_SCHEDULED`.
  It needs access to every account of the job (the job is otherwise `404` for the member).
  `409` with `details.reason: "NOT_CANCELLABLE"` when nothing is left to cancel.
- **Cancel destination** does the same for one destination.
- **Retry destination** needs state `FAILED` (`409 NOT_FAILED` otherwise) and gives the
  destination a fresh set of automatic attempts. Body: `{ "acknowledgeDuplicateRisk": true }`
  is required after an uncertain failure (`409` with `details.reason: "DUPLICATE_RISK"`
  without it). `409 ACCOUNT_REMOVED` if the account is gone; `503` if the queue is down.

All three answer `{ publishJob }`.

### Scheduled jobs

```http
GET   /api/v1/workspaces/:workspaceId/publish-jobs?status=SCHEDULED&order=scheduled&limit=20
PATCH /api/v1/workspaces/:workspaceId/publish-jobs/:jobId/schedule
```

```json
{ "scheduledAt": "2026-11-25T09:30:00+05:30" }
```

- `order=scheduled` lists only jobs that have a scheduled time, soonest first. Its
  `nextCursor` is an opaque string valid only with the same order; a malformed cursor is
  `422`.
- **Change time** moves every destination still in `SCHEDULED` to the new instant. Others
  (being sent, sent, failed, cancelled) are untouched. The rules for the time are those of
  creation: in the future and at most 90 days ahead (`422` otherwise).
- `409 NOT_RESCHEDULABLE` when no destination is waiting for its time any more (it started,
  finished or was cancelled meanwhile). `409 MODE_CHANGED` when the server's publishing mode
  is no longer the job's. `503` when the queue is down: nothing changes.
- Each destination moves in one atomic update guarded by its state, so a destination a
  worker has just claimed stays as it is. The old queue entry is removed (best effort) and a
  new delayed entry is added; an old entry that still arrives finds the destination not due
  and does nothing, so the post can neither go out at the old time nor twice.
- Answers `{ publishJob }`. Activity entry: `publish_job.rescheduled` (counts and times only).
- A scheduled job publishes the content as it was when the job was created.

### Status

```json
{
  "mode": "SIMULATED",
  "workspaceMode": "SIMULATED",
  "liveAvailable": false,
  "canPublish": false,
  "reason": "QUEUE_UNAVAILABLE",
  "message": "The publishing queue has not been set up on this server yet (REDIS_URL is not set).",
  "queue": { "status": "NOT_CONFIGURED" },
  "worker": { "status": "UNKNOWN" },
  "storage": { "publicUrls": false }
}
```

Members see only what the screen needs. Server-wide queue counts, the number of workers and
the storage driver would reveal other workspaces' activity and the setup, so they are only on
`/api/v1/health/details` (operator token). A workspace's own figures are on
`GET /publish-jobs/summary`, limited to the jobs the reader may see.

- `mode`: the mode this workspace's new posts get (`DISABLED`, `SIMULATED` or `LIVE`).
  `workspaceMode` is the workspace's own choice; `liveAvailable` says whether the server
  offers real publishing at all.
- `queue.status`: `NOT_CONFIGURED`, `CONNECTING`, `READY`, `UNAVAILABLE`.
- `worker.status`: `RUNNING` (at least one worker is connected to the queue, in any
  process), `NOT_RUNNING`, or `UNKNOWN` while the queue cannot be asked.

### Publishing mode of the workspace

`PUT /workspaces/:workspaceId/publishing/mode`, owners and admins (`workspace:update`).

```json
{ "mode": "LIVE", "password": "…", "acknowledgeRealPublishing": true }
```

- Switching to `LIVE` needs the person's password and `acknowledgeRealPublishing: true`
  (`422` otherwise), the server in `live` mode (`409 LIVE_NOT_AVAILABLE`) and a configured
  Meta app (`409 META_NOT_CONFIGURED`).
- `{ "mode": "SIMULATED" }` always works and needs no password.
- Answers with the new status (above). Every change is recorded in the activity log
  (`publishing.mode_changed`, from/to) and stored on the workspace
  (`publishingMode`, `publishingModeChangedAt`, `publishingModeChangedBy`).
- The web app shows it as **Settings › Publishing mode**.

## 4. Permissions

- Reading needs `content:read`; creating, rescheduling, cancelling and retrying need
  `content:publish`. Viewers cannot publish.
- **Visibility.** Owners, admins and members with access to all accounts see every job.
  Members with selected accounts see a job only if they may use every account it targets
  **and** every account its draft targeted when the job was made (`draftTargetAccounts`; a
  job shows the draft's caption and files). Other jobs are left out of lists, the summary
  counts and Analytics, and answer `404` to read, cancel, reschedule or retry, the same as an
  unknown id. Jobs made before `draftTargetAccounts` existed use their draft's current
  accounts. (Before 2026-11-21 hidden jobs were shown with the forbidden accounts left out,
  and until 2026-11-23 a job sent to fewer accounts than its draft could show a hidden
  draft's caption.) One rule, `contentPackages/contentAccess.js`, serves every one of these.
- **Drafts.** A job can only be created from a draft the member can see (the draft
  visibility rule in [ARCHITECTURE.md](ARCHITECTURE.md)); otherwise `404 Draft not found`,
  whichever `socialAccountIds` the request names.
- Every account is checked with `accessibleAccountFilter`, the same rule the account screens
  use. Unknown ids, accounts of another workspace and accounts not assigned to the member
  all get the same `422`, so ids cannot be probed.
- Jobs of another workspace answer `404`.
- Error messages name accounts only by the names the member may already see, never by id.

## 5. Worker, health and recovery

- By default the API process runs the worker (`PUBLISHING_WORKER_INLINE=true`). To run it
  separately, set that to `false` and start `npm run worker -w @socialhub/api`.
- `PUBLISHING_CONCURRENCY` destinations are processed at once (default 5).
- **Recovery sweep**, at worker start and every minute:
  - a destination left `PROCESSING` for more than 15 minutes: if it was never handed to the
    platform it is queued again (or fails plainly once its attempts are used up); if it was,
    it is marked `INTERRUPTED` and only a person retries it;
  - a waiting destination that is more than 2 minutes overdue gets a new queue entry
    (Redis was down when it was created, or Redis lost its data);
  - a job whose stored status lags behind its destinations (a status update failed) is
    recalculated.
- On shutdown the HTTP server and the workers stop taking work at once; each worker waits up
  to 90 seconds (`WORKER_DRAIN_MS`) for the posts it is publishing, then the process exits
  (forced 10 seconds later). Give the process that long before a process manager kills it; a
  post cut off anyway is marked `INTERRUPTED`, never sent twice. On Windows, where there is no
  `SIGTERM`, a process manager sends the IPC message `shutdown` instead (`server.js` and
  `scripts/publish-worker.js` both handle it).
- Timings: `PUBLISHING_CLAIM_SECONDS` (900), `PUBLISHING_REQUEUE_SECONDS` (120) and
  `PUBLISHING_RECOVERY_INTERVAL_SECONDS` (60), in `apps/api/.env`.
- Files of a post that is scheduled or on its way cannot be deleted and are skipped by
  `media:cleanup`, even after the draft is deleted.

Activity log entries: `publish_job.created`, `publish_job.rescheduled`,
`publish_job.cancelled`, `publish_job.finished`, `publish_destination.retried`,
`publish_destination.cancelled`, `publish_destination.blocked` (with `reason`:
`NOT_A_MEMBER`, `NO_PUBLISH_PERMISSION` or `NO_ACCOUNT_ACCESS`).

## 6. Redis

- Docker: `docker compose up -d redis` (the repository's `docker-compose.yml`).
- Windows without Docker: **Memurai Developer** (Redis API 7.0), see README, "Installing
  Redis", for the exact steps.
- Then set `REDIS_URL=redis://127.0.0.1:6379` in `apps/api/.env` and run, in this order:
  1. `npm run queue:verify -w @socialhub/api`: uses a temporary queue name, touches no
     MongoDB data and publishes nothing. Checks connection, version, insertion and
     retrieval, the payload, a worker, completion, a crashing job (failed, not repeated),
     a retry as a new entry, reconnecting after `CLIENT KILL`, graceful close; removes its
     own keys.
  2. `npm run publishing:verify -w @socialhub/api`: starts a real API process and a real
     worker process on Redis database 15 (which must be empty; it is flushed at the end)
     and a temporary in-memory MongoDB (never Atlas), then publishes in SIMULATED mode
     through the real queue. `--hold N` and `--info <file>` keep it running for manual
     checks.
- The scripts close only their own Redis connections to test reconnection: `queue:verify`
  those named with its process id and its temporary queue's worker; `publishing:verify` only
  database 15. A running API or worker on the same server is not disconnected (checked with a
  bystander client). Still, run one script at a time.

### Verification against a real Redis (2026-11-23)

Redis was Memurai Developer 4.1.2 (Redis API 7.2.5), run unpacked from its installer as an
ordinary process on `127.0.0.1:6379` with append-only persistence, because the Windows
installer had failed (error 1603: its setup step could not create a temporary folder). The
Developer edition is for development and testing only and stops itself after 10 days.

| Check (2026-11-23)                                     | Redis                      | Meta                        | Result                                                               |
| ------------------------------------------------------ | -------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `npm run queue:verify`                                 | **real** (Memurai 4.1.2)   | none                        | 22/22                                                                |
| `npm run publishing:verify` (API and worker processes) | **real**, database 15      | simulated adapter           | 47/47, 1 skipped (Windows service restart)                           |
| Redis server restart while the API runs                | **real** (SHUTDOWN, start) | simulated adapter           | 9/9                                                                  |
| Worker across a Redis server restart                   | **real**                   | none                        | 9/9                                                                  |
| Bystander client during both scripts                   | **real**                   | none                        | never disconnected (519 pings, 0 failed)                             |
| Publishing screen, composer Publish, "Change time"     | **real** (via the API)     | simulated adapter           | viewed in headless Chrome at 360, 768, 1024, 1440 px, light and dark |
| Automated tests (shared, API, web)                     | test-only stand-in         | simulated Meta / mocked API | see Testing                                                          |

What the real runs covered: one job to several accounts, each processed on its own; a partial
failure (`PARTIALLY_PUBLISHED`, not `FAILED`); temporary failures retried through Redis with
growing waits (2.4 s, then 4.9 s) and a stop after 3 attempts; a manual retry, and a second
click refused; the same request sent 5 times at once creating one job; a post refused for an
account it is already on its way to; one destination with 6 queue entries published once;
cancellation removing the delayed entries; an uncertain outcome not retried without
confirmation; a worker that finishes its current destination on a clean stop; jobs created
while the worker was off processed after it restarts; a killed worker's destination marked
`INTERRUPTED`, never published twice; the recovery sweep re-queuing waiting destinations
after Redis lost its data; API and worker reconnecting after their connections were cut and
after a full Redis server restart (with a scheduled entry kept); `503 QUEUE_UNAVAILABLE` and
nothing written while Redis was down; no Meta token, encrypted token or Graph API request in
Redis, API answers or logs; no post id on any simulated destination.

Problems the real runs found, all fixed and re-run:

1. **The queue could break for good** (`Stream isn't writeable and enableOfflineQueue options
is false`). The Queue was created with `skipWaitingForReady`, so BullMQ sent its version
   check before the socket was open; it failed and BullMQ kept that failure. The API would
   have stayed unable to publish whenever Redis was not connected at the moment the queue was
   created. `publishQueue.js` now lets BullMQ wait (`test/publishQueue.test.js` guards it).
2. **The reconnection checks cut every client of the server** (`CLIENT KILL TYPE normal`),
   including a running API. They now close only their own connections.
3. **The token check flagged SocialHub's own sign-in token** (a field named `accessToken` in
   the sign-up answer). It now reports each pattern; the Meta token and encrypted tokens were
   absent everywhere.
4. **The check's test accounts lacked the permissions a real sync records**, so the composer
   (which reads permissions) blocked them while the API (which reads the stored
   `publishingStatus`) accepted them. The test data now matches a synced account. For real
   accounts both come from the same sync and agree.

BullMQ needs Redis 5 or newer and recommends 6.2 or newer.

## 7. Real publishing

### Switching it on (two deliberate steps)

1. **Server operator:** set `PUBLISHING_MODE=live` in `apps/api/.env` and restart the API.
   This only makes real publishing _available_; every workspace keeps publishing in simulation.
2. **Workspace owner or admin:** **Settings › Publishing mode › Switch on real publishing**,
   tick the acknowledgement and enter their password (`PUT /publishing/mode`).

Switching back (**Switch back to simulation**, or `PUBLISHING_MODE=simulated` on the server)
takes effect immediately: new posts are simulated, and live posts still waiting are refused
at send time with nothing sent.

Also needed: `META_APP_ID` / `META_APP_SECRET` (and the Instagram pair for Instagram Login),
connected accounts whose publishing readiness is **Ready** (permissions granted and, for Pages,
a Page role with the `CREATE_CONTENT` task), and media storage Meta can download from:

- `STORAGE_DRIVER=s3` with a public HTTPS `STORAGE_PUBLIC_BASE_URL`, or
- `STORAGE_DRIVER=local` when `API_PUBLIC_URL` is a public HTTPS address (for example a
  Cloudflare tunnel). Files are then served at `{API_PUBLIC_URL}/api/v1/storage/objects/…`
  under long random names. `isPublicHttpsUrl` (`apps/api/src/storage/localStorage.js`) treats
  `localhost`, private networks and plain `http` as not public. It cannot prove the address is
  reachable; if Meta cannot download a file, the post fails with Meta's message.

### What is checked before anything is sent

At job creation (`422` with the reasons) and again by the worker just before sending:

| Check                   | Rule                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Both switches           | Server `live` and workspace `LIVE`; otherwise refused, never simulated instead                                                                         |
| Author still allowed    | Still a member, still has `content:publish`, may still use the account (section 2)                                                                     |
| Account                 | Connection and account `ACTIVE`, publishing readiness `READY`; an expired Instagram Login token needs a reconnect                                      |
| Meta app                | Configured for the account's login type                                                                                                                |
| Text                    | `publishIssues`: Instagram needs media, ≤ 2,200 characters, ≤ 30 hashtags, ≤ 20 @mentions, ≤ 10 files                                                  |
| Files (`mediaIssues`)   | Facebook photos JPEG/PNG/GIF/BMP/TIFF ≤ 10 MB; Instagram images JPEG only, ≤ 8 MB, aspect 4:5 to 1.91:1; videos MP4/MOV; reels 3 s to 15 min, ≤ 300 MB |
| Files reachable         | Public HTTPS URL on the active storage driver                                                                                                          |
| Instagram 24-hour limit | `GET /{ig-id}/content_publishing_limit` before a container is made; used up → `RATE_LIMITED`, checked again in an hour                                 |

Limits come from Meta's documentation read on 2026-11-23 (Pages API photos and videos
references; Instagram Content Publishing, `ig-user/media`, `ig-container`,
`content_publishing_limit`). Codecs, bitrates and frame rates are not checked here; Meta
reports them as a rejection with its own message.

### Graph API calls

| Post                     | Calls                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook, text           | `POST /{page-id}/feed` (`message`) → `id`                                                                                             |
| Facebook, one image      | `POST /{page-id}/photos` (`url`, `caption`, `alt_text_custom`) → `post_id`                                                            |
| Facebook, several images | `POST /{page-id}/photos` (`url`, `published=false`) per image, then `POST /{page-id}/feed` (`attached_media[n]`) → `id`               |
| Facebook, video          | `POST /{page-id}/videos` (`file_url`, `description`) → video `id`, then `GET /{video-id}?fields=status,permalink_url` until processed |
| Instagram, image         | limit check, `POST /{ig-id}/media` (`image_url`, `caption`), wait for `status_code=FINISHED`, `POST /{ig-id}/media_publish` → `id`    |
| Instagram, video         | as above with `video_url`, `media_type=REELS`, `share_to_feed=true` (a reel that also shows in the feed)                              |
| Instagram, carousel      | one container per file (`is_carousel_item`, videos `media_type=VIDEO`), a `CAROUSEL` container with the caption, then `media_publish` |

Every call uses the account's own token (Page token for Pages and for Instagram accounts
reached through a Page; the Instagram token for Instagram Login), read from the encrypted
store by the worker at the moment of sending, with `appsecret_proof` on graph.facebook.com.

### When a post counts as published

Only when Meta returned the post or media id. An answer without an id is
`OUTCOME_UNKNOWN`. A Facebook video is reported only after Facebook says it finished
processing and publishing (`status.video_status=ready`, publishing phase `complete`); while
it processes, the video id is saved and the next attempt checks the **same** video again
instead of uploading another one. A video that fails processing is `PLATFORM_REJECTED`
(nothing published). If the status cannot be read, the outcome is unknown. Instagram reports
parts it could not apply (`config_issue`, for example `CAPTION_NOT_ATTACHED`) as warnings on
the published post.

### Errors, retries and duplicates

- **Never sent twice automatically.** The call that creates the post is "committing". If it
  gets no answer, an unreadable answer, a server error without Meta's `is_transient` marker,
  or Meta's "unknown error" (code 1), the post may exist: `OUTCOME_UNKNOWN`, no automatic
  retry, and a person must confirm the retry (`acknowledgeDuplicateRisk`). Only explicit
  refusals (`is_transient`, code 2, rate limits, validation errors) are retried automatically.
- **Resume, don't repeat.** The Instagram container id and the Facebook video id are saved
  before publishing; retries continue from them. An Instagram container already `PUBLISHED`
  is never published again.
- **Rate limits** (codes 4, 17, 32, 341, 368, 613, Business Use Case 80000–80014, and
  Instagram's publishing limit, subcode 2207042) wait at least 10 minutes, or as long as
  Meta's `estimated_time_to_regain_access` usage header says, or an hour for the publishing
  limit.
- **Expired or revoked tokens** fail as `ACCOUNT_NEEDS_RECONNECT`; missing permissions as
  `PERMISSION_DENIED`. Neither is retried automatically.
- **Tokens and the app secret** never leave the worker: not in queue entries, jobs,
  destinations, API answers, error messages (provider text is sanitised) or logs.

### Verified, and still open

Verified with automated tests against a **simulated** Meta (`apps/api/test/publishing.live.test.js`,
`publishing.mode.test.js`): every call above, the switches, the checks, error mapping,
resuming, and that a simulated job never calls Meta.

Still to do with **real** accounts, with the owner's approval for each test post:

1. One text post, one photo and one video to a test Page; confirm the ids and links.
2. One image and one reel to a test Instagram professional account.
3. Whether Meta accepts `alt_text` on Instagram image containers (not in the pages read).
4. Whether `GET /{video-id}?fields=status` reports processing as described: Meta's current
   Video reference does not list the field. If it does not, Facebook videos end as
   `OUTCOME_UNKNOWN` ("check the Page") instead of `PUBLISHED`, never as a duplicate.
5. That Meta can download files through the Cloudflare quick tunnel.
6. **Meta approval:** in Development mode only people with a role on the Meta app can
   publish. Publishing for anyone else needs App Review for `pages_manage_posts`,
   `pages_read_engagement`, `pages_show_list`, `instagram_basic` and
   `instagram_content_publish` (or `instagram_business_*` for Instagram Login), Business
   Verification, and the app switched to Live mode.

## 8. Known limitations

- **First comments are not posted.** They need Meta permissions SocialHub does not request.
  The destination gets the warning `FIRST_COMMENT_NOT_SENT`; hashtags placed in the first
  comment get `HASHTAGS_NOT_SENT`.
- **Publishing needs team drafts** (`VITE_COMPOSER_SERVER_DRAFTS=true`): the composer saves
  the post as a draft first, and "Publish a draft" lists saved drafts (the 50 most recent).
- A scheduled job publishes the content as it was when the job was created; editing the
  draft afterwards does not change it. Changing the time does not change the content.
- Job visibility for members with selected accounts is computed per request with indexed
  `distinct` queries (destinations, `draftTargetAccounts`, and drafts for older jobs); very
  large histories may need a precomputed list.
- The Scheduled tab orders by scheduled time; other tabs are newest first.
- The queue was verified on Memurai Developer, first as a temporary unpacked copy, then on the
  installed Windows service. The Developer edition must not be used in production.
- Instagram containers and Facebook videos are checked for about a minute per attempt;
  longer processing waits for the next attempt, which resumes with the saved id.
- Instagram carousels are limited to 10 files although Meta now documents 20; raise
  `INSTAGRAM_CAROUSEL_MAX` once 20 is confirmed with a real account.
- Facebook Reels, Stories, link previews and first comments are not published.
