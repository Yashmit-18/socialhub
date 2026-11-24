# SocialHub

SocialHub is a team-based platform for managing Facebook Pages and Instagram
professional accounts. It runs on the MERN stack (MongoDB, Express, React, Node.js) and
integrates with the official Meta Graph API.

> **Current status**
>
> - **Phase 1 (foundation): complete.** Accounts, workspaces, teams, role-based access
>   control, the audit log and the dashboard.
> - **Phase 2 (Meta OAuth integration): implemented, awaiting live verification.** The code
>   and its automated tests are done. They run against a simulated Meta, because no real
>   Meta Developer App has been used yet. Phase 2 is **not complete** until it has been
>   tested with a real Meta app and authorized test accounts; see
>   [Meta integration](#meta-integration).
> - **Phase 3 (social account management): implemented; real-Meta sync not yet
>   verified.** The dashboard, login, Page and Instagram views, synchronization with
>   history, least-privilege team access and detail pages work on the records that the
>   Phase 2 integration creates. They are tested with controlled data and the simulated
>   Meta. Real synchronization needs the same live Meta app as Phase 2. Until Meta
>   credentials are configured, the app shows a "Meta setup required" state and never
>   invents accounts or sync results.
> - **Phase 4 (composer): frontend and backend implemented.** The
>   composer (`/w/:slug/compose`) can save team drafts, upload media and share account
>   presets through the API. Those three features are switched on per deployment (see
>   [Composer backend](#composer-backend)), and media upload needs storage to be configured.
>   The S3 storage driver has not been run against a real bucket yet.
> - **Phase 5 (publishing engine): implemented and verified in simulation.** Posts can be
>   published now or scheduled, from the composer or the Publishing screen
>   (`/w/:slug/publishing`). The queue was verified on a real Redis (Memurai, 2026-11-23).
> - **Phase 8 (real Facebook and Instagram publishing): implemented, off by default, not yet
>   run against real accounts.** It needs two deliberate switches: `PUBLISHING_MODE=live` on
>   the server and an owner or admin switching the workspace on with their password. Until
>   then every post is simulated. See [Real publishing](#real-publishing).
> - **Analytics (Phase 7): implemented; Meta insights not enabled.** The Analytics screen
>   (`/w/:slug/analytics`) reports SocialHub's own publishing records, with simulated and live
>   publishing always kept apart. Reading insights from Meta has no switch yet and has only
>   met a simulated Meta; a development-only demo mode makes insights that are labelled as
>   demo data everywhere. See [Analytics](#analytics).

- [Architecture and data model](docs/ARCHITECTURE.md)
- **[Phase 2 real-world verification runbook](docs/PHASE2_VERIFICATION.md)**: what to do with your Meta app and test accounts, and how results are verified
- [Meta integration](#meta-integration)
- [Social account management](#social-account-management)
- [Composer backend](#composer-backend): drafts, media storage and account presets
- [Composer API contract](docs/COMPOSER_API_CONTRACT.md)
- [Analytics](docs/ANALYTICS.md): formulas, API, insights sync, what Meta insights still need
- **[Meta setup guide](META_SETUP_GUIDE.md)**: step-by-step Meta Developer Dashboard setup,
  with notes on which facts were checked against Meta's docs
- [Project history](#project-history)
- [Roadmap](#roadmap)

---

## Tech stack

| Layer  | Technology                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------- |
| Web    | React 19, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, React Hook Form + Zod                 |
| API    | Node.js ≥ 20.19, Express 5, Mongoose 9 (MongoDB), Zod 4, pino                                             |
| Auth   | bcrypt passwords, short-lived JWT in memory, rotating httpOnly refresh cookie                             |
| Meta   | Facebook Login (Graph API, default v27.0) and Instagram API with Instagram Login; official endpoints only |
| Shared | `@socialhub/shared`: RBAC matrix, domain enums and validation schemas used by both apps                   |
| Tests  | Vitest 5, Supertest, mongodb-memory-server (replica set), Testing Library                                 |
| Queue  | BullMQ 6 on Redis (ioredis) for the publishing engine. Redis is required to publish; there is no fallback |

## Repository layout

```
.
├── apps/
│   ├── api/                 Express API
│   │   ├── src/integrations/meta/   Meta HTTP client, Facebook + Instagram OAuth/Graph calls
│   │   ├── src/modules/meta/        OAuth flow, connections, discovery, sync, Meta callbacks
│   │   ├── src/modules/socialAccounts/  account listing, summaries, details, team access
│   │   ├── scripts/                 index sync, scheduled Meta sync
│   │   └── test/                    API tests (+ fakeMeta.js: test-only simulated Meta)
│   └── web/                 React dashboard (src/, public/)
│       └── src/pages/workspace/accounts/  Social accounts section (Phase 3)
├── packages/
│   └── shared/              RBAC, enums, Zod schemas (+ tests)
├── docs/ARCHITECTURE.md     Data model, service boundaries, phase designs
├── docker-compose.yml       MongoDB (single-node replica set) + Redis for local dev
├── eslint.config.js         Lint rules for the whole monorepo
└── package.json             npm workspaces + root scripts
```

## Getting started

### 1. Prerequisites

- Node.js **20.19+** (22 LTS recommended) and npm 10+.
- A MongoDB **replica set**, which multi-document transactions require. Use one of:
  - `docker compose up -d`, which starts a single-node replica set plus Redis.
  - A MongoDB Atlas cluster.
  - A local `mongod --replSet rs0`, initialised once with `rs.initiate()`.

  A standalone MongoDB also works. SocialHub detects it, logs a warning, and falls back to
  non-transactional writes with compensation. Use a replica set in production.

- **Redis 6.2+**, only for publishing. Everything else works without it. See
  [Publishing engine](#publishing-engine).

### 2. Install

```bash
npm install
```

### 3. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
npm run secrets            # prints JWT_ACCESS_SECRET and TOKEN_ENCRYPTION_KEY
```

Paste the two generated values into `apps/api/.env` and set `MONGODB_URI`. Every variable
is documented in [`apps/api/.env.example`](apps/api/.env.example). The API validates its
configuration at startup and refuses to boot with a clear message if anything is invalid.

The Meta integration stays **disabled** until you add Meta app credentials; see
[Meta integration](#meta-integration). Everything else works without them.

The web app needs no configuration in development. Vite proxies `/api` to
`http://localhost:4000`, so the browser sees a single origin.

### 4. Run

```bash
npm run dev                # API on :4000 and web on :5173 (concurrently)
```

Open <http://localhost:5173>, create an account and create your first workspace.

> **Email.** Without `SMTP_*` settings, no email is sent.
>
> - In development, invitation and password-reset links are written to the API log.
> - In production these links are **never** logged, because they are bearer secrets.
>   Configure SMTP before relying on password reset.
> - The invite dialog always shows the link and says whether it was emailed.

## Scripts (run from the repository root)

| Command                                                         | What it does                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                   | Starts the API (watch mode) and web dev server together                                                                                                                                                                 |
| `npm run dev:api` / `npm run dev:web`                           | Starts one side only                                                                                                                                                                                                    |
| `npm test`                                                      | Runs all test suites (shared, API, web)                                                                                                                                                                                 |
| `npm run lint`                                                  | ESLint across the monorepo; fails on any warning                                                                                                                                                                        |
| `npm run build`                                                 | Production build of the web app to `apps/web/dist`                                                                                                                                                                      |
| `npm run verify`                                                | `lint` + `test` + `build`: the pre-merge gate                                                                                                                                                                           |
| `npm start`                                                     | Starts the API in production mode                                                                                                                                                                                       |
| `npm run secrets`                                               | Generates fresh secrets for `.env`                                                                                                                                                                                      |
| `npm run format` / `format:check`                               | Prettier                                                                                                                                                                                                                |
| `npm run db:indexes -w @socialhub/api`                          | Builds or reconciles MongoDB indexes; run this on deploy                                                                                                                                                                |
| `npm run meta:sync -w @socialhub/api`                           | Re-validates every Meta connection and records each run in its sync history; schedule it daily (e.g. cron)                                                                                                              |
| `npm run meta:verify -w @socialhub/api -- --live --log api.log` | Read-only, evidence-based check of the Phase 2 real-world checklist (never prints tokens)                                                                                                                               |
| `npm run media:cleanup -w @socialhub/api`                       | Removes abandoned uploads and stored files no draft uses; schedule it (e.g. hourly)                                                                                                                                     |
| `npm run storage:verify -w @socialhub/api`                      | Checks the configured S3 bucket with real requests: upload, copy, public delivery, link reuse, CORS, listing, deletion                                                                                                  |
| `npm run storage:verify-local -w @socialhub/api`                | Checks `STORAGE_DRIVER=local` against the real configured folder: uploads an image and a video through the real API, looks at the files on disk, restarts the API, deletes, cleans up. Uses a temporary private MongoDB |
| `npm run queue:verify -w @socialhub/api`                        | Checks the publishing queue against the real Redis in `REDIS_URL` (connection, delivery, delay, removal, no duplicates)                                                                                                 |
| `npm run worker -w @socialhub/api`                              | Runs the publish worker as its own process (only with `PUBLISHING_WORKER_INLINE=false`)                                                                                                                                 |
| `npm run analytics:verify -w @socialhub/api`                    | Checks insights sync against the real Redis in `REDIS_URL` with real API and worker processes (Redis database 14, temporary MongoDB, demo insights only: nothing is read from Meta)                                     |

---

## Meta integration

### What it does

- **Multiple identities per workspace.** A workspace can connect any number of
  **Facebook logins**. Each is stored as its own `SocialConnection`. Connecting another
  identity never changes an existing one, and re-authorizing the same identity updates its
  connection.
- **Discovery and selection.** For each login, SocialHub asks Meta for **every Page** that
  person manages (following pagination) plus the **Instagram professional accounts linked
  to those Pages**. A manager chooses which of them to add as `SocialAccount`s.
- **Instagram directly.** An **Instagram Business or Creator account** can also be
  connected on its own with Instagram Login, with no Facebook Page needed. Personal
  accounts are refused.
- **Duplicates.** If an account is already connected through another _healthy_ login, it
  is shown as such and never taken over. It moves to a new login only when the original
  connection is broken.
- **Token storage.** Tokens are exchanged server-side for long-lived tokens and stored
  **AES-256-GCM encrypted**. They are never sent to the browser or included in any API
  response or log.
- **Health tracking.** SocialHub tracks:
  - token expiry and the data-access expiry date Meta reports (`data_access_expires_at`);
  - granted and declined permissions;
  - whether the login holds the `CREATE_CONTENT` task on each Page;
  - revoked or expired tokens (OAuth error 190);
  - accounts the login can no longer reach.

  Connection health and publishing readiness are tracked **separately**. Readiness only
  describes permissions, since publishing is Phase 4.

- **Account management.** Managers can reconnect (re-prompting declined permissions),
  sync, disconnect (erases tokens and keeps the accounts listed) or remove a connection,
  or remove a single account. Phase 3 builds the full management views on top of this;
  see [Social account management](#social-account-management).
  - Revocation at Meta happens only when **no other workspace** still uses that identity.
- **Meta callbacks.** Deauthorize and data-deletion callbacks are verified with the app
  secret.
- **Configuration review.** `GET /api/v1/integrations/meta` returns `checks` that flag
  missing scopes, non-HTTPS URLs, and a callback host the browser cookie cannot reach.
  It also returns a per-login `ready` flag.
- **Activity log.** Every account change is recorded.

### OAuth security

| Control                   | How                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF / state              | 256-bit random `state`, stored as SHA-256 only, single-use (atomic), expires in 10 minutes, bound to provider and workspace                        |
| Browser binding           | httpOnly cookie (per flow, `Path=/api/v1/oauth`) that must match on callback, so a leaked authorization URL cannot be completed in another browser |
| Authorization at callback | The user's workspace role is re-checked when Meta redirects back                                                                                   |
| Reconnect identity check  | Reconnecting with a different Meta account is refused (`IDENTITY_MISMATCH`)                                                                        |
| Token handling            | Code exchange and long-lived exchange are server-side; tokens are encrypted at rest and every Graph call includes `appsecret_proof`                |
| Logs and URLs             | The callback redirect carries only an outcome code; `code`, `state` and tokens are redacted from access logs                                       |

### Meta permissions requested

| Permission                           | Login     | Why                                                                          | App Review               |
| ------------------------------------ | --------- | ---------------------------------------------------------------------------- | ------------------------ |
| `pages_show_list`                    | Facebook  | **Required.** Lists the Pages the person manages                             | Yes, for Advanced Access |
| `pages_read_engagement`              | Facebook  | Page metadata; prerequisite for publishing                                   | Yes                      |
| `pages_manage_posts`                 | Facebook  | Publishing to Pages (used in Phase 4)                                        | Yes                      |
| `instagram_basic`                    | Facebook  | Reads Instagram professional accounts linked to Pages                        | Yes                      |
| `instagram_content_publish`          | Facebook  | Publishing to Page-linked Instagram accounts (Phase 4)                       | Yes                      |
| `instagram_business_basic`           | Instagram | **Required** for Instagram Login; reads the account and allows token refresh | Yes, for Advanced Access |
| `instagram_business_content_publish` | Instagram | Publishing with Instagram Login (Phase 4)                                    | Yes                      |

Scopes are configurable (`META_FACEBOOK_SCOPES`, `INSTAGRAM_SCOPES`). With
`META_FACEBOOK_LOGIN_CONFIG_ID` set, Facebook Login for Business uses that configuration's
permissions instead.

**Optional, not requested by default:**

- `business_management`: Meta documents it for Business Manager API use cases, not for
  listing Pages.
- `ads_management` and `ads_read`: Meta's content-publishing guide requires them for
  publishing to Instagram when the person's Page role comes from Business Manager
  (Phase 4).

Add them to `META_FACEBOOK_SCOPES` only when needed.

### Meta Developer Dashboard setup (manual)

The full walkthrough, including troubleshooting and App Review, is in
**[META_SETUP_GUIDE.md](META_SETUP_GUIDE.md)**. This is the short version.
`API_PUBLIC_URL` below is the public **HTTPS** origin where Meta reaches the API.

1. **Create the app** at developers.facebook.com. Add the **Facebook Login** (or
   **Facebook Login for Business**) product and the **Instagram** product ("API setup with
   Instagram business login").
2. **App settings → Basic**
   - Copy the App ID and App Secret into `META_APP_ID` / `META_APP_SECRET`.
   - Set App Domains, a Privacy Policy URL, Terms of Service URL, app icon and category.
   - Under **User Data Deletion**, choose _Data deletion callback URL_ and enter
     `API_PUBLIC_URL/api/v1/meta/facebook/data-deletion`.
3. **Facebook Login → Settings**
   - **Valid OAuth Redirect URIs:** `API_PUBLIC_URL/api/v1/oauth/facebook/callback`. Strict
     Mode is required, so it must match exactly.
   - Client OAuth login **on**; Web OAuth login **on**; Enforce HTTPS **on**.
   - Meta does not document `localhost` redirects, so use an HTTPS URL (see below).
   - **Deauthorize callback URL (optional):**
     `API_PUBLIC_URL/api/v1/meta/facebook/deauthorize`.
     - Meta documents that the callback can be enabled, but not the request format.
     - SocialHub expects the same form-encoded `signed_request` that the data-deletion
       callback uses.
4. **Facebook Login for Business (optional).** Create a configuration with _User access
   token_ and the permissions above, then put its ID in `META_FACEBOOK_LOGIN_CONFIG_ID`.
5. **App settings → Advanced:** turn on **Require App Secret**. SocialHub signs every call
   with `appsecret_proof`.
6. **Instagram → API setup with Instagram business login**
   - Copy the **Instagram App ID / Secret** into `INSTAGRAM_APP_ID` /
     `INSTAGRAM_APP_SECRET`. These differ from the Meta App ID.
   - Business login settings:
     - OAuth redirect URI: `API_PUBLIC_URL/api/v1/oauth/instagram/callback`.
     - Deauthorize callback: `API_PUBLIC_URL/api/v1/meta/instagram/deauthorize`.
     - Data deletion request URL: `API_PUBLIC_URL/api/v1/meta/instagram/data-deletion`.
   - Meta does not document which secret signs these callbacks or which id they carry, so:
     - SocialHub accepts a signature from either the Instagram or the Meta app secret;
     - it matches either the Instagram user id or the professional account id.
7. **App roles → Roles.** Add the Facebook and Instagram accounts that will test the app.
   In Development mode, only people with a role on the app can authorize it, and only
   their own Pages and accounts are returned.
8. **Restart the API.** Log in as an owner or admin; **Social accounts** now shows
   **Connect Facebook** / **Connect Instagram**. `GET /api/v1/integrations/meta` lists the
   exact URLs this server expects.

**Going live** (serving accounts you don't own) requires:

- **App Review** for each permission, with screencasts of the feature that uses it;
- **Business Verification**;
- switching the app to **Live** mode.

### Publishing engine

One prepared post is sent to many Facebook Pages and Instagram accounts. Each account is
tracked on its own, so one failing never hides that the others worked. The full description
and the API are in [docs/PUBLISHING_API.md](docs/PUBLISHING_API.md).

> **Simulation is the default.** In simulated mode the whole process runs (queue, worker,
> retries, history) but **nothing is sent to Facebook or Instagram**, and every such post is
> labelled "Simulated". Real publishing exists (Phase 8) but stays off until both switches
> below are on; it has not yet been run against real accounts.

### What it does

- **Publishing screen** (`/w/:slug/publishing`): scheduled (soonest first), queue,
  processing, published, partly published, failed and cancelled posts; the state of every
  account; details with attempts and plain error messages; retry a failed account; cancel
  what is still waiting; change the time of a scheduled post; "Publish a draft" for saved
  team drafts, now or at a chosen time.
- **Publish from the composer:** the Publish button saves the post as a team draft, then
  sends it to the selected accounts now or at a scheduled time, and shows each account's
  status as it changes. It lists what must be fixed first (Meta's rules per platform, files
  still uploading), says plainly when it is a simulation, and never calls a simulated post
  published.
- **Scheduling with time zones:** pick a date and time in the workspace time zone (or any
  other); the same moment is shown in your own time when it differs. Past times, times less
  than 2 minutes ahead, times more than 90 days ahead and times skipped by a clock change are
  refused before anything is sent.
- **Draft privacy:** owners and admins see every draft and post. Editors and viewers with
  selected accounts only see drafts and posts whose every account they may use; everything
  else does not exist for them (enforced by the API, see
  [ARCHITECTURE.md](docs/ARCHITECTURE.md), "Draft visibility").
- **One record per account**, with its own state, attempts, error and history.
- **Retries** with growing waits for temporary problems (30 s, 60 s, 120 s, …, up to 4
  attempts by default). Problems that will not fix themselves fail at once.
- **No duplicates**: the same request sent twice creates one job; the same post cannot be on
  its way to an account twice; a worker must claim an account before publishing to it.
- **No blind repeats**: if it is unknown whether a post went out, it is not retried
  automatically. A person decides.
- **Access rules**: viewers cannot publish; members can only publish to accounts assigned to
  them; workspaces never see each other's jobs.
- **Tokens** are read only by the worker at the moment of publishing. They are never in the
  queue, in job records, in logs or in API answers.

### Turning it on (simulation)

1. Install Redis (below) and set in `apps/api/.env`:

   ```ini
   REDIS_URL=redis://127.0.0.1:6379
   PUBLISHING_MODE=simulated
   ```

2. Check the queue: `npm run queue:verify -w @socialhub/api`, then the whole path:
   `npm run publishing:verify -w @socialhub/api`.
3. Start the app. The API runs the publish worker itself.
4. Publishing works from saved team drafts (composer Publish and "Publish a draft"): set
   `VITE_COMPOSER_SERVER_DRAFTS=true` in `apps/web/.env` (and `VITE_COMPOSER_MEDIA_UPLOAD=true`
   to send photos and videos).

Without Redis the app still runs. The Publishing screen then says the queue is not
available, and creating a job answers `503 QUEUE_UNAVAILABLE`. Nothing is queued in memory
instead.

### Real publishing

Off by default, and it takes two deliberate steps:

1. The server operator sets `PUBLISHING_MODE=live` in `apps/api/.env` and restarts the API.
   On its own this publishes nothing: every workspace stays in simulation.
2. A workspace owner or admin opens **Settings › Publishing mode**, chooses **Switch on real
   publishing**, ticks the acknowledgement and enters their password. It is recorded in the
   activity log. **Switch back to simulation** is always available and needs no password.

Posts keep the mode they were created in. Real posts still waiting when real publishing is
switched off are refused, never quietly simulated.

Before anything is sent, SocialHub checks the account (connected, Page role, permissions,
token), the text and every file against Meta's documented limits (for example Instagram
images must be JPEG, at most 8 MB, aspect ratio 4:5 to 1.91:1; reels 3 s to 15 min), that Meta
can download the files over public HTTPS, and Instagram's 24-hour publishing limit. A post is
shown as published only when Meta returned its id; a Facebook video only once Facebook says it
finished processing. Calls, error handling and what is still unverified:
[PUBLISHING_API.md, section 7](docs/PUBLISHING_API.md#7-real-publishing).

> **Meta approval:** while the Meta app is in Development mode, only people with a role on the
> app can publish through it. Publishing for other accounts needs App Review for the
> publishing permissions, Business Verification and the app in Live mode.

### Installing Redis

- **With Docker:** `docker compose up -d redis`.
- **Windows without Docker** (pick one):
  - **Memurai Developer** (recommended here; a Redis-compatible Windows service, Redis API
    7.0, by Janea Systems). Its Developer edition is licensed for development and testing:
    read the licence before installing. In an **administrator** PowerShell:

    ```powershell
    winget install --id Memurai.MemuraiDeveloper --exact --source winget
    Get-Service Memurai*          # should say Running
    Test-NetConnection 127.0.0.1 -Port 6379   # TcpTestSucceeded : True
    ```

    Or download the installer from <https://www.memurai.com/get-memurai>. Keep the default
    port 6379; it runs as a Windows service and starts with Windows. Then set
    `REDIS_URL=redis://127.0.0.1:6379` in `apps/api/.env` (`.env.example` has the line, empty).

    If the installer fails with error 1603 and its log
    (`%LOCALAPPDATA%\Packages\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe\LocalState\DiagOutputDir\Memurai*.log`)
    shows `SFXCA: Failed to create temp directory. Error code 5`, it was not run with
    administrator rights: run it again from an **Administrator** PowerShell. That happened on
    this machine on 2026-11-21; the first 2026-11-23 verification used Memurai unpacked from
    the same installer and run as an ordinary process instead, then removed. Later on
    2026-11-23 Memurai was installed from an administrator PowerShell and now runs as the
    `Memurai` Windows service (automatic start, `127.0.0.1:6379`).

  - **WSL:** in an administrator PowerShell run `wsl --install`, restart, then in Ubuntu:
    `sudo apt update && sudo apt install -y redis-server && sudo service redis-server start`.
    Windows reaches it at `127.0.0.1:6379`.
- Check it answers: `npm run queue:verify -w @socialhub/api` must end with "All checks passed".

BullMQ needs Redis 5 or newer and recommends 6.2 or newer.

### What is verified

| Part                                                                                                                               | Status                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine logic: jobs, per-account states, retries, backoff, cancellation, idempotency, duplicates, permissions, workspace separation | Automated tests, real MongoDB, simulated adapter, test-only queue                                                                                                                                                                                                                                                            |
| Facebook and Instagram adapters                                                                                                    | Tests against a **simulated** Meta only. Never run against the real Graph API                                                                                                                                                                                                                                                |
| Queue code against a real Redis                                                                                                    | **Verified 2026-11-23** on Memurai 4.1.2 (Redis API 7.2.5): `queue:verify` 22/22, `publishing:verify` 47/47 (real API and worker processes, simulated Meta), Redis server restart 9/9, worker across a restart 9/9. Details in [docs/PUBLISHING_API.md](docs/PUBLISHING_API.md#verification-against-a-real-redis-2026-11-23) |
| Draft and job visibility per role                                                                                                  | API tests through real requests (`draftPrivacy.test.js`): owner, admin, editor, viewer, mixed accounts, direct requests, workspaces                                                                                                                                                                                          |
| Scheduling (change time, soonest-first list) and composer Publish                                                                  | API tests with the test-only queue; web tests with a mocked API; screens viewed in headless Chrome with mocked data                                                                                                                                                                                                          |
| API without Redis, and with Redis down                                                                                             | Run for real: clear 503 and status messages, nothing queued                                                                                                                                                                                                                                                                  |
| Publishing screen                                                                                                                  | Component tests; viewed in headless Chrome with mocked data, and on 2026-11-23 against the real API and queue (all tabs, "Change time", composer Publish, Redis unreachable) at 360, 768, 1024 and 1440 px, light and dark                                                                                                   |
| Real publishing                                                                                                                    | Disabled. Needs Meta credentials, publishing permissions and public HTTPS media storage                                                                                                                                                                                                                                      |

## Analytics

The **Analytics** screen (`/w/:slug/analytics`, every role) shows two kinds of numbers that
are never mixed. Details, formulas and the API: [docs/ANALYTICS.md](docs/ANALYTICS.md).

- **Publishing figures** from SocialHub's own records: posts, deliveries per state, success
  rate, average publishing time, retries, results per day and per account. Simulated and live
  publishing are always shown separately and never added together.
- **Insights** (reach, views, engagement, followers and more) from one source at a time:
  Meta, or demo data. A metric that was not reported shows **Unavailable**, never 0, and each
  total says how many accounts reported it.
- Filters: date range (today, 7, 30 or 90 days, or custom, in the workspace time zone),
  platform, account and insights source. CSV exports of accounts, posts and publishing history.
  Members restricted to some accounts only see those accounts and the posts that use only them.

### Turning on insights sync

- `ANALYTICS_MODE=disabled` (default): publishing figures work; "Sync insights" explains why it
  is unavailable and the API answers `503`.
- `ANALYTICS_MODE=simulated` (development only; refused in production): a sync makes **demo
  insights**, stored with source `SIMULATED` and labelled as demo data on every screen and
  export. It needs Redis, like publishing.
- There is no setting that reads insights from Meta. That first needs new Meta permissions and
  App Review: see [Meta insights](docs/ANALYTICS.md#6-meta-insights-not-enabled).
- The analytics worker runs inside the API by default; with `ANALYTICS_WORKER_INLINE=false` it
  runs in `npm run worker -w @socialhub/api` instead.

### What is verified (analytics)

| Part                                                                                    | Status                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Figures, formulas, filters, time zones, paging, access per role and account, workspaces | Automated tests: shared 14, API 27 (real requests, in-memory MongoDB)                                                                |
| Sync logic: duplicates, retries and backoff, partial results, recovery, no secrets      | API tests with a test-only queue (22)                                                                                                |
| Sync on a real Redis                                                                    | **Verified 2026-11-23** on Memurai 4.1.2: `analytics:verify` 34/34 (real API and worker processes, simulated Meta)                   |
| Analytics screen                                                                        | 18 component tests; viewed in headless Chrome against the real API with seeded records at 360, 768, 1024 and 1440 px, light and dark |
| Meta insights adapter                                                                   | Tests against a **fake** Meta transport only. **Never run against Meta**; switched off                                               |

## Testing against a real Meta app locally

Meta requires HTTPS redirect URIs. The browser-binding cookie also requires the web app
and the callback to be on the **same origin**. The simplest setup is one HTTPS tunnel
(e.g. `cloudflared` or `ngrok`) to a production-style build:

```bash
npm run build
# apps/api/.env:
#   SERVE_WEB_DIST=../web/dist
#   APP_URL=https://<tunnel-host>
#   CLIENT_ORIGIN=https://<tunnel-host>
#   API_PUBLIC_URL=https://<tunnel-host>
#   TRUST_PROXY=1                          # the tunnel is a reverse proxy
npm start                                  # API + web on :4000
cloudflared tunnel --url http://localhost:4000
```

Then open `https://<tunnel-host>` (not `localhost`), register the tunnel URLs in the
dashboard (steps 2–6), and connect using an account that has a role on the app.

The Vite dev server (`npm run dev`) is not suitable here: it rejects unknown tunnel hosts,
and it puts the web app on a different host from the callback. `GET
/api/v1/integrations/meta` reports that host mismatch as `CALLBACK_HOST_MISMATCH`.

**Live verification checklist** (needed before Phase 2 can be called complete):

- Connect two different Facebook logins to one workspace; both stay connected.
- One login manages several Pages; all of them are listed and the selected ones are added.
- A Page-linked Instagram account appears and can be added.
- Connect an Instagram Business or Creator account through Instagram Login.
- Cancel the consent dialog; then decline a permission and use **Reconnect** to grant it.
- Remove the app from Facebook settings; the deauthorize callback marks the connection
  revoked.
- Disconnect and remove; **Sync now** reflects role or permission changes made in Meta.

### Keeping connections healthy

Run `npm run meta:sync -w @socialhub/api` daily (e.g. with cron). It:

- re-validates every active connection with `debug_token`;
- refreshes Instagram tokens (they must be at least 24 hours old);
- updates permissions and Page access;
- flags accounts the login can no longer reach;
- records every attempt in the login's sync history (trigger `SCHEDULED`). Logins whose
  Meta app is not configured, that are already syncing, or that need reconnecting are
  skipped and counted as such.

Managers can also sync one login, or all of them, from the dashboard. A BullMQ repeatable
job replaces cron in Phase 4. Connections show expired as soon as their recorded expiry
passes, even before a sync.

### Limitations imposed by Meta

- **Development mode:** only people with a role on the app can connect, and only to their
  own assets.
- **Advanced Access** for every permission needs App Review and Business Verification.
- **Token lifetimes:**
  - Facebook long-lived user tokens last about 60 days.
  - Page tokens derived from them do not expire, but stop working if the person loses the
    Page role, changes their password or removes the app.
  - **Data access lapses** on the date Meta reports in `data_access_expires_at`. The
    person must then reconnect.
- Instagram long-lived tokens last 60 days. They can only be refreshed after 24 hours and
  before they expire; a token not refreshed within 60 days can no longer be refreshed.
- People must select the Pages in Meta's consent dialog. Unselected Pages are not
  returned by `/me/accounts`.
- Publishing readiness requires the `CREATE_CONTENT` Page task, as documented by Meta. A
  `MANAGE` task alone is not treated as enough.
- Meta's docs disagree on the token for Page-linked Instagram publishing: the publishing
  guide says a Page token, the IG User reference says a User token. SocialHub keeps both,
  the Page token on the account and the User token on the connection, for Phase 4.
- Instagram accounts reached through a Page do not expose Business vs Creator (shown as
  "professional account"). Instagram Login does expose it.
- Whether an Instagram account's Instagram Login ID equals its Page-linked ID is not
  documented by Meta. Duplicate detection relies on the professional account ID
  (`user_id`).
- Revoking at Meta (`DELETE /me/permissions`) removes the app for the person everywhere,
  which is why SocialHub only does it when no other workspace uses that identity.
  Instagram Login has no documented revocation endpoint.
- Meta applies rate limits; those errors are classified and surfaced, not retried in a
  loop.

---

## Social account management

Phase 3 adds the **Social accounts** section (`/w/:slug/accounts`). It manages the real
records that the Meta integration creates; it never creates accounts on its own. With no
Meta app configured, the section shows a **"Meta setup required"** notice, and connect,
reconnect and sync are unavailable with that explanation. The server answers
`409 META_NOT_CONFIGURED` without contacting Meta, so no synchronization result is ever
invented.

| Tab / page         | Who                     | What it shows and does                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**       | everyone                | Totals: Facebook logins, Facebook Pages, Instagram accounts, connected accounts, expired and revoked logins, accounts needing attention, plus a readiness breakdown. A "needs attention" list with the fix (reconnect or sync). A searchable table of every account. A "This workspace / All my workspaces" scope when you belong to several workspaces. |
| **Logins**         | owner, admin            | One card per Facebook or Instagram login: picture, name, status, connected date, last successful sync, token expiry and its Pages and Instagram accounts. One login can manage many Pages, and the same Page can be reachable through several logins. Actions: view, choose accounts, sync now, sync all, reconnect, disconnect, remove.                 |
| **Login detail**   | owner, admin            | Health, token and data-access expiry, granted, declined and missing permissions, its accounts, the full sync history and its activity.                                                                                                                                                                                                                   |
| **All accounts**   | everyone (own accounts) | Facebook Pages and Instagram accounts in one table with labels, stars, CSV export and every bulk action (refresh, labels, team access, removal). See [docs/ACCOUNT_ORGANIZATION.md](docs/ACCOUNT_ORGANIZATION.md).                                                                                                                                       |
| **Facebook Pages** | everyone (own accounts) | Name, picture, Page ID, login, `CREATE_CONTENT` eligibility, publishing readiness, status and last sync. Search, filters, sorting, pagination. Managers can select Pages for bulk refresh, access changes or removal.                                                                                                                                    |
| **Instagram**      | everyone (own accounts) | Username, picture, account type, linked Facebook Page, login, readiness, status and last sync, with the same table features and per-account reconnect. Only professional (Business or Creator) accounts exist in SocialHub.                                                                                                                              |
| **Account detail** | everyone (own accounts) | Account information, connection health and readiness reasons, the login and linked Page or Instagram accounts, permissions and Page role. Managers also see sync history and activity; admins see and edit team access.                                                                                                                                  |
| **Team access**    | owner, admin            | Each member's account access, an editor for it, and which accounts each member can use.                                                                                                                                                                                                                                                                  |

- **Readiness is computed on every read.** An account is marked "Publishing permissions
  OK" only when its login is usable, every publishing permission is granted and, for
  Page-based accounts, Meta reported the `CREATE_CONTENT` Page task. A Page without it is
  never shown as ready, and an unknown Page role counts as missing. Publishing itself is
  Phase 4.
- **Synchronization** checks each login with Meta, refreshes its accounts and records the
  attempt in its sync history:
  - expired or revoked tokens and removed permissions are marked on the login and its
    accounts;
  - temporary Meta failures are retried once, then reported without changing the login's
    status;
  - one sync per login runs at a time;
  - "Sync all" reports a result for every login, and one failure never stops the others;
  - existing records are updated in place, so syncing never creates duplicates or breaks
    relationships.
- **Team access is least-privilege.** Owners and admins use every account. Editors and
  viewers see only the accounts assigned to them, and new members and invitations start
  with none. An invitation can grant accounts up front. Every account route enforces this
  on the server; an account the member may not use answers `404`.
- **Organisation** (added 2026-11-21): workspace labels (client, brand, region…), personal
  stars, team notes, sorting by followers, CSV export of the current filters, and "Open on
  Facebook / Instagram" and "Copy Meta ID" actions. Details, rules and the API are in
  [docs/ACCOUNT_ORGANIZATION.md](docs/ACCOUNT_ORGANIZATION.md).

---

## Composer backend

The composer's server side (Phase 4). Request and response shapes are in
[docs/COMPOSER_API_CONTRACT.md](docs/COMPOSER_API_CONTRACT.md).

### What it does

- **Drafts.** A draft is stored in MongoDB as a content package: caption, per-platform
  captions, hashtags, internal SEO keywords, first comment, media with alt text, and the
  accounts it is meant for.
  - Every save names the version it was based on. A stale save answers `409` and changes
    nothing, so two people cannot overwrite each other.
  - Once a draft exists, the composer autosaves edits a few seconds after the last change.
    The browser draft keeps running as a fallback.
- **Media upload.** The browser uploads straight to storage with a short-lived link that is
  bound to one file. The API then checks the stored file (size, real type, dimensions) before
  marking it ready. A file is never shown as uploaded before that check passes.
- **Account presets.** Named sets of accounts shared by a workspace.
- **Permissions.** Reading needs `content:read`; creating, changing and deleting need
  `content:create`. A draft or preset can only use accounts its author has access to, and
  readers only see the accounts they have access to.
- **Activity log.** Draft created/updated/deleted, media uploaded/deleted and preset
  created/deleted are recorded, without the post text.

### Turning it on

The composer uses the API only where a flag is set at build time in `apps/web/.env`
(see `apps/web/.env.example`). Without a flag, that feature stays in the browser.

| Flag                                | Feature        | Also needs                    |
| ----------------------------------- | -------------- | ----------------------------- |
| `VITE_COMPOSER_SERVER_DRAFTS=true`  | Team drafts    | –                             |
| `VITE_COMPOSER_SERVER_PRESETS=true` | Shared presets | –                             |
| `VITE_COMPOSER_MEDIA_UPLOAD=true`   | Media upload   | Storage configured on the API |

### Media storage

Configured in `apps/api/.env` (see `apps/api/.env.example`). No storage secret reaches the
browser.

| `STORAGE_DRIVER` | Use              | Notes                                                                                                         |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| _(empty)_        | Uploads disabled | Upload requests answer `503 STORAGE_NOT_CONFIGURED`                                                           |
| `local`          | Development      | Files in `STORAGE_LOCAL_DIR`, served by the API. Meta cannot fetch them, so they cannot be published for real |
| `s3`             | Production       | Any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO)                                                       |

**Local storage (`STORAGE_DRIVER=local`).** This is what the project uses now.

```ini
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR="F:/Social Hub Data"
```

- `STORAGE_LOCAL_DIR` is an absolute folder, or a path relative to `apps/api` (default
  `./storage-data`, which Git ignores). Quote paths with spaces and use forward slashes.
  Keep it outside the repository.
- The folder is created when the API starts. If it cannot be created or written to, the API
  refuses to start and says so.
- Two folders are used inside it:
  - `uploads\<workspace>\<file id>\…` for files that have just arrived and are not verified;
  - `workspaces\<workspace>\media\<file id>\…` for verified files.
- File names on disk are generated by the server. The name a person uploads is only stored
  in MongoDB and is never used as a path. Keys that try to leave the folder are refused.
- **MongoDB keeps the records** (users, workspaces, drafts, media details, presets,
  publishing jobs, activity). **Only the image and video bytes are on the drive.**
- Uploading, verification, the copy from `uploads` to `workspaces`, one-time upload links,
  deletion, clean-up and workspace separation work exactly as with S3.
- **Meant for development.** Files on this computer are not reachable from the internet, so
  Facebook and Instagram cannot fetch them. Real publishing refuses posts whose media is
  stored locally.
- Back the folder up yourself. Nothing else holds a copy of the files.

Check it at any time, against the real folder:

```bash
npm run storage:verify-local -w @socialhub/api
```

**Moving existing files to a new folder.** No files existed in the old location
(`apps/api/storage-data`) when the folder was changed on 2026-11-21, so nothing had to be
moved. If you change the folder later:

1. Stop the API.
2. Copy the whole old folder (both `uploads` and `workspaces`) to the new place, keeping the
   structure: `robocopy "<old>" "<new>" /E /COPY:DAT /R:2 /W:2`. This copies; it does not
   delete.
3. Set `STORAGE_LOCAL_DIR` to the new folder and start the API.
4. Open a draft with media and check the pictures load. MongoDB needs no change: it stores
   the path below the folder, not the folder itself.
5. Only then remove the old folder, by hand.

For `s3`:

1. Set `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`,
   `STORAGE_S3_SECRET_ACCESS_KEY` and, for non-AWS providers, `STORAGE_S3_ENDPOINT`.
2. Set `STORAGE_PUBLIC_BASE_URL` to the public HTTPS address of the bucket or its CDN. Meta
   fetches media from it when publishing.
3. Give the access key `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on the
   bucket's objects, plus `s3:ListBucket` on the bucket. Without `ListBucket`, S3 answers
   `403` for a file that has not arrived yet and uploads cannot be completed. This does not
   make the bucket publicly listable.
4. Make only the `workspaces/` prefix publicly readable. Keep `uploads/` private and bucket
   listing off.
5. Add a CORS rule on the bucket that allows `PUT` with the `Content-Type` header from the
   web app's origin.
6. Schedule `npm run media:cleanup -w @socialhub/api` hourly (cron or Task Scheduler). It
   never deletes a file that a draft uses.

Ready-to-paste key permissions, bucket policy and CORS rule, and notes for AWS S3 and
Cloudflare R2, are in
[docs/COMPOSER_API_CONTRACT.md](docs/COMPOSER_API_CONTRACT.md) under "Setting up the bucket".

7. Verify the bucket: `npm run storage:verify -w @socialhub/api`. It uploads, copies,
   downloads through the public URL, reuses the upload link with a same-size file, checks
   CORS and listing, and deletes its test objects.

**How uploads are protected.** The browser's upload link points at a temporary key. When
the upload is completed, the API copies the file to a final key that no link can write to
and verifies that copy. Reusing the link afterwards cannot change the verified file. Make
only the `workspaces/` prefix public; `uploads/` holds unverified files.

**Not verified yet:** the S3 driver is tested against a simulated provider and Amazon's
documented signing example. `storage:verify` has not been run against a real bucket:
as of 2026-11-21 no storage is configured in `apps/api/.env`, so every real-bucket check
and the composer's real upload are **blocked**. Storage credentials belong only in
`apps/api/.env`, never in `apps/web/.env`.

## Testing

```bash
npm test
```

- **API tests** run against an in-memory MongoDB **replica set**, so the transactional code
  paths are exercised. Each test file gets its own database. No external services are
  needed.
- **Meta in tests** is simulated by `apps/api/test/fakeMeta.js`.
  - It is installed through a transport hook that the code **refuses outside
    `NODE_ENV=test`**.
  - It enforces Meta's contracts: client credentials, exact redirect URI, single-use codes,
    `appsecret_proof`, token validity, OAuth error 190 subcodes, and Instagram's
    data-wrapped responses with the `#_` code suffix.
  - It does not replace testing against a real Meta app.
- Key security checks were **mutation-tested**. Removing the browser binding, the state
  expiry, the callback permission re-check, duplicate protection, or the cross-workspace
  revocation guard each makes a test fail.
- The first run downloads a MongoDB binary. To reuse a local `mongod`, set
  `MONGOMS_SYSTEM_BINARY` to its path.
- An **ESM integrity test** loads every API module under Node's native loader. This
  catches broken imports that Vitest's transform would otherwise hide.
- **Simulated versus real Meta.** Tests that involve Meta say so in their file header and
  in their `describe` names ("simulated Meta"). Account-access and health-rule tests use
  controlled records and make no Meta calls at all. Web tests mock SocialHub's own API with
  `fetch` and never involve Meta. **No test calls the real Meta API.**

| Suite  | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared | 77    | RBAC matrix and hierarchy rules; validation schemas; composer limits and request schemas; publishing states, transitions, job status rules and request schemas; schedule list order, page links and new-time requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| api    | 661   | Phase 1: auth, sessions, refresh rotation, password flows, workspaces, roles, members, invitations, activity, config, security headers (CSP), CORS, redaction. Phase 2: OAuth state and callback validation, browser binding, cancellation, permission re-check, reauthorization and identity mismatch, Instagram Login, multiple connections, multi-Page pagination, selection, duplicates, encryption and no token leakage, permissions, workspace isolation, expired and revoked tokens, declined permissions, lost Page roles, Instagram refresh, sync, disconnect, remove, deauthorize and data-deletion callbacks, Graph error classification. Phase 3 (simulated Meta and controlled data): multiple logins and Pages per login, independent records, duplicate prevention, listing filters, sorting, pagination, facets and summaries, cross-workspace listing, workspace isolation, role-based visibility, Instagram management, sync outcomes and history, sync lock and races with disconnect, reconnect and removal, transient-failure retry, missing Meta configuration, disconnection and removal, CREATE_CONTENT eligibility, least-privilege team access, invitation grants, hierarchy and optimistic concurrency, health rules. Follower totals (simulated Meta). Phase 4: draft CRUD, version conflicts and simultaneous saves, autosave runs, paging, workspace isolation, roles and account restrictions, media upload slots, file validation, real file-type and dimension checks, storage outages, abandoned-upload clean-up, upload links that cannot overwrite a verified file, account presets and duplicate names, activity entries, S3 request signing (Amazon's documented example) and the S3 driver against a simulated provider. Local storage folder: creation, paths with spaces, keys that cannot leave it. Phase 5 publishing: job creation, queue unavailable and not configured, worker runs, several accounts, partial failure, retries and backoff, idempotency and simultaneous requests, duplicate prevention, cancellation, interrupted workers, roles, account access, workspace isolation, no token leakage, media protection, simulated adapter, Facebook and Instagram adapters against a simulated Meta, real publishing disabled, local media refused for real publishing. Draft privacy (owner, admin, editor, viewer, selected and all accounts, mixed drafts, hidden drafts in lists, pages and counts, direct requests, files of hidden drafts, workspace isolation, publishing and job visibility); scheduling (change time, old queue entries, claimed accounts, limits, soonest-first list) |
| web    | 1,133 | API client, route guards, login, onboarding, permission-gated UI; Phase 2: connect and redirect, reconnect, account selection with duplicates locked, reconnect-required state, OAuth result messages, malformed result URLs; Phase 3: dashboard figures and scopes, needs-attention fixes, filters sent to the API, logins with sync, reconnect, disconnect and remove, login and account detail pages, Pages and Instagram tables with bulk refresh, access and removal, sync results, setup-required state, team access editing (PATCH and PUT), invitation account grants, role-based visibility; follower totals; Phase 4 composer (881 of these): editors, media, account selection and presets, previews, readiness checks, browser drafts, team drafts with autosave and conflicts, uploads, session expiry, request bodies checked against the shared schemas; Phase 5 Publishing screen (32): lists, tabs, simulation labelling, queue and mode banners, per-account states, retry with duplicate warning, cancel, read-only viewers, publishing a draft once per click; public landing page; scheduling (time zones and clock changes, Scheduled tab, change time, scheduling a draft); composer Publish (simulation wording, draft saved first, accounts and time sent, blocking problems, server refusals, same key on retry, unavailable states)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Counts are from 2026-11-21, after draft privacy, scheduling and composer Publish. Tests of the S3 storage driver use a simulated
provider: **no test talks to a real bucket.** Publishing tests use a test-only queue and a
simulated Meta: **no test talks to Redis or to the real Graph API.**

## Production

- **Build the web app:** `npm run build`.
- **Single-origin deployment (recommended).** Set `SERVE_WEB_DIST=../web/dist` and the API
  serves the SPA with an SPA fallback.
  - The refresh cookie then stays first-party and `SameSite=Lax` works unchanged.
  - This is also what the Meta OAuth browser binding expects.
- **Separate origins.** If the web app and API are on different sites:
  - set `CLIENT_ORIGIN` to the web app's origin;
  - set `COOKIE_SAMESITE=none`, which requires `COOKIE_SECURE=true`;
  - set `API_PUBLIC_URL` to the API origin;
  - build the web app with `VITE_API_URL=https://api.example.com/api/v1`.
- **Behind a proxy or load balancer,** set `TRUST_PROXY` (for example `1`) so rate limits
  and audit IPs use the real client address.
- **Indexes.** `NODE_ENV=production` disables automatic index builds. Run
  `npm run db:indexes -w @socialhub/api` on each deploy.
- **Meta sync:** schedule `npm run meta:sync -w @socialhub/api` daily.
- **Rate limits** are in-memory per instance. When running several API instances, switch
  to a Redis-backed store.
- **Security headers:** Helmet CSP (`script-src 'self'`, no inline scripts; images and
  media may also come from `https:` and from `blob:` URLs the page creates for local file
  previews), `upgrade-insecure-requests` in production, HSTS, `nosniff` and frame
  protection. Access logs never include headers, invitation tokens or OAuth codes.

Deploying is a deliberate, manual step: nothing in this repository deploys automatically.

## API reference (v1)

All routes are prefixed with `/api/v1`.

- Bodies are JSON and are validated strictly; unknown fields are rejected with `422`.
- Errors use the shape `{ error: { code, message, requestId, details? } }`.
- Publishing endpoints (`/workspaces/:id/publishing/status`, `/workspaces/:id/publish-jobs…`)
  are documented in [docs/PUBLISHING_API.md](docs/PUBLISHING_API.md).
- Analytics endpoints (`/workspaces/:id/analytics/…`: overview, trends, accounts, posts,
  top-posts, publishing-performance, sync-status, export, sync) are documented in
  [docs/ANALYTICS.md](docs/ANALYTICS.md#4-api).

**Auth and users**

| Method | Path                    | Auth                          | Notes                                                       |
| ------ | ----------------------- | ----------------------------- | ----------------------------------------------------------- |
| POST   | `/auth/register`        | –                             | Returns `{ user, accessToken }` and sets the refresh cookie |
| POST   | `/auth/login`           | –                             | Rate-limited                                                |
| POST   | `/auth/refresh`         | cookie + `X-SocialHub-Client` | Rotates the refresh token                                   |
| POST   | `/auth/logout`          | cookie + `X-SocialHub-Client` | Revokes this session                                        |
| POST   | `/auth/logout-all`      | bearer                        | Revokes every session                                       |
| GET    | `/auth/me`              | bearer                        |                                                             |
| POST   | `/auth/forgot-password` | –                             | Always `202` (no account enumeration)                       |
| POST   | `/auth/reset-password`  | –                             | Single-use token; revokes all sessions                      |
| PATCH  | `/users/me`             | bearer                        | Update name                                                 |
| POST   | `/users/me/password`    | bearer                        | Revokes other sessions                                      |

**Workspaces**

| Method     | Path                                 | Permission                                                    |
| ---------- | ------------------------------------ | ------------------------------------------------------------- |
| GET / POST | `/workspaces`                        | authenticated                                                 |
| GET        | `/workspaces/:id`                    | member                                                        |
| PATCH      | `/workspaces/:id`                    | `workspace:update`                                            |
| DELETE     | `/workspaces/:id`                    | `workspace:delete`; body `{ confirmation, password }`         |
| GET        | `/workspaces/:id/overview`           | member; stats scoped to the caller's permissions              |
| POST       | `/workspaces/:id/transfer-ownership` | `workspace:transfer_ownership`; body `{ memberId, password }` |
| POST       | `/workspaces/:id/leave`              | member (the owner must transfer ownership first)              |

**Members and invitations**

| Method     | Path                                               | Permission                                                                         |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET        | `/workspaces/:id/members`                          | `members:read`                                                                     |
| PATCH      | `/workspaces/:id/members/:memberId`                | `members:manage`; strictly lower-ranked targets only                               |
| PUT        | `/workspaces/:id/members/:memberId/account-access` | `members:manage`; replaces the grant `{ mode, socialAccountIds }`                  |
| PATCH      | `/workspaces/:id/members/:memberId/account-access` | `members:manage`; incremental `{ add, remove }` (P3); `409` on a concurrent change |
| DELETE     | `/workspaces/:id/members/:memberId`                | `members:manage`                                                                   |
| GET / POST | `/workspaces/:id/invitations`                      | `members:invite`; POST may include `accountAccess` for editors and viewers (P3)    |
| POST       | `/workspaces/:id/invitations/:invId/resend`        | `members:invite`; issues a new link                                                |
| DELETE     | `/workspaces/:id/invitations/:invId`               | `members:invite`                                                                   |
| GET        | `/invitations/:token`                              | public preview                                                                     |
| POST       | `/invitations/:token/accept`                       | bearer; the email must match the invitation                                        |

**Social accounts and the Meta integration**

| Method | Path                                                 | Permission / auth                                                                                                                                                                                    |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/integrations/meta`                                 | authenticated; per-login `configured`/`ready`, scopes, the URLs to register with Meta, and `checks[]` (`{id, level, provider, message}`); no secrets                                                 |
| POST   | `/workspaces/:id/meta/authorizations`                | `social_connections:manage`; body `{ provider, connectionId? }`; returns Meta's URL and sets the binding cookie                                                                                      |
| GET    | `/oauth/:provider/callback`                          | Meta redirect (`facebook`/`instagram`); validated by state and binding cookie; 302 back to the web app                                                                                               |
| GET    | `/workspaces/:id/social-connections`                 | `social_connections:manage`; health, expiry, missing permissions, account counts, attention, last sync attempt and outcome                                                                           |
| POST   | `/workspaces/:id/social-connections/sync`            | `social_connections:manage`; body `{ connectionIds? }`; syncs logins one by one → per-login `outcome` or `skipReason`, plus a summary (P3)                                                           |
| GET    | `/workspaces/:id/social-connections/:cid`            | `social_connections:manage`; login detail: accounts, permissions, recent sync history and activity (P3)                                                                                              |
| GET    | `/workspaces/:id/social-connections/:cid/sync-runs`  | `social_connections:manage`; `?cursor&limit`; full sync history (P3)                                                                                                                                 |
| GET    | `/workspaces/:id/social-connections/:cid/discovery`  | `social_connections:manage`; live list of Pages and Instagram accounts (no tokens)                                                                                                                   |
| POST   | `/workspaces/:id/social-connections/:cid/accounts`   | `social_connections:manage`; body `{ accounts: [{ platform, externalId }] }`                                                                                                                         |
| POST   | `/workspaces/:id/social-connections/:cid/sync`       | `social_connections:manage`; `409 META_NOT_CONFIGURED` / `SYNC_IN_PROGRESS` / `META_RECONNECT_REQUIRED`, `502 META_UNAVAILABLE`                                                                      |
| POST   | `/workspaces/:id/social-connections/:cid/disconnect` | `social_connections:manage`; erases tokens, keeps accounts listed                                                                                                                                    |
| DELETE | `/workspaces/:id/social-connections/:cid`            | `social_connections:manage`; removes the connection, its accounts and its sync history                                                                                                               |
| GET    | `/workspaces/:id/social-accounts`                    | `social_accounts:read`; only the member's accessible accounts; `?q&platform&status&readiness&attention&connectionId&sort&page&limit` → items with computed `health`, `total`, `pages`, `facets` (P3) |
| GET    | `/workspaces/:id/social-accounts/summary`            | `social_accounts:read`; dashboard figures; login figures only for `social_connections:manage` (P3)                                                                                                   |
| POST   | `/workspaces/:id/social-accounts/refresh`            | `social_connections:manage`; body `{ accountIds }`; syncs each parent login once → per-account results (P3)                                                                                          |
| POST   | `/workspaces/:id/social-accounts/remove`             | `social_connections:manage`; body `{ accountIds }` → `{ removed }` (P3)                                                                                                                              |
| GET    | `/workspaces/:id/social-accounts/:accountId`         | `social_accounts:read` and access to that account (else `404`); detail with permissions, linked accounts, history, activity, team access (P3)                                                        |
| POST   | `/workspaces/:id/social-accounts/:accountId/refresh` | `social_connections:manage`; syncs the account's login (P3)                                                                                                                                          |
| GET    | `/workspaces/:id/social-accounts/:accountId/access`  | `members:manage`; who can use the account (P3)                                                                                                                                                       |
| PATCH  | `/workspaces/:id/social-accounts/:accountId/access`  | `members:manage`; body `{ grant: [memberId], revoke: [memberId] }`; hierarchy enforced (P3)                                                                                                          |
| DELETE | `/workspaces/:id/social-accounts/:accountId`         | `social_connections:manage`                                                                                                                                                                          |
| GET    | `/social-accounts` and `/social-accounts/summary`    | authenticated; read-only, across every workspace the user belongs to; `?workspaceId` filter (P3)                                                                                                     |
| POST   | `/meta/:provider/deauthorize`                        | Meta (form `signed_request`, HMAC-verified)                                                                                                                                                          |
| POST   | `/meta/:provider/data-deletion`                      | Meta (form `signed_request`); returns `{ url, confirmation_code }`                                                                                                                                   |
| GET    | `/meta/data-deletion/:code`                          | public status of a deletion request                                                                                                                                                                  |
| GET    | `/workspaces/:id/activity?cursor&limit`              | `activity:read`                                                                                                                                                                                      |
| GET    | `/health`                                            | public; only `{ status, database }`; `503` if the database is down                                                                                                                                   |
| GET    | `/health/details`                                    | monitoring only: `Authorization: Bearer <HEALTH_DETAILS_TOKEN>`; version, queues, workers, modes. Without the token configured, or with a wrong one, `404`                                           |

**Composer (Phase 4)**

| Method | Path                                                   | Permission / notes                                           |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| GET    | `/workspaces/:id/content-packages?status&cursor&limit` | `content:read`; drafts, newest first                         |
| POST   | `/workspaces/:id/content-packages`                     | `content:create`; creates a draft (version 1)                |
| GET    | `/workspaces/:id/content-packages/:packageId`          | `content:read`                                               |
| PATCH  | `/workspaces/:id/content-packages/:packageId`          | `content:create`; full save with `version`; `409` when stale |
| DELETE | `/workspaces/:id/content-packages/:packageId`          | `content:create`                                             |

Drafts are returned only to members who may use every account they target (owners and
admins always); others get `404`. Publishing endpoints (`/publish-jobs…`, including
`PATCH /publish-jobs/:jobId/schedule`) are listed in
[docs/PUBLISHING_API.md](docs/PUBLISHING_API.md).
| POST | `/workspaces/:id/media/uploads` | `content:create`; body `{ fileName, mimeType, sizeBytes, kind }`; returns the upload link |
| POST | `/workspaces/:id/media/:mediaId/complete` | `content:create`; verifies the stored file; `409 UPLOAD_INCOMPLETE` if it has not arrived |
| GET | `/workspaces/:id/media/:mediaId` | `content:read` |
| DELETE | `/workspaces/:id/media/:mediaId` | `content:create`; uploader or admin; `409` while a draft uses it |
| GET | `/workspaces/:id/account-presets` | `content:read` |
| POST | `/workspaces/:id/account-presets` | `content:create`; body `{ name, socialAccountIds }`; `409` for a duplicate name |
| DELETE | `/workspaces/:id/account-presets/:presetId` | `content:create`; creator or admin |
| PUT / GET | `/storage/uploads/:token`, `/storage/objects/*` | Only with `STORAGE_DRIVER=local`: upload target and file serving (signed, expiring links only) |
| GET | `/workspaces/:id/group-categories` | `content:read`; categories of the group directory with group counts |
| POST / PATCH / DELETE | `/workspaces/:id/group-categories[/:categoryId]` | `groups:manage`; `409` for a duplicate name; deleting leaves its groups without a category |
| GET | `/workspaces/:id/facebook-groups` | `content:read`; query `q`, `category` (id or `none`), `tag`, `status` (`ACTIVE`, `ARCHIVED`, `ALL`), `sort`, `page`, `limit`; facets for categories, tags and status |
| POST | `/workspaces/:id/facebook-groups` | `groups:manage`; body `{ name, url, categoryId?, tags?, memberCount?, notes?, minDaysBetweenShares? }`; `409` when the group is already listed |
| GET / PATCH / DELETE | `/workspaces/:id/facebook-groups/:groupId` | read: `content:read` (with sharing history); change: `groups:manage`; `PATCH {status: "ARCHIVED"}` archives; `DELETE` is `409` once something was shared there |
| GET / POST | `/workspaces/:id/group-shares` | read: `content:read` (with progress); create: `groups:manage`, body `{ title, message, link?, groupIds, assigneeId?, dueAt? }`, returns `{ share, created, skipped }` |
| GET / PATCH / DELETE | `/workspaces/:id/group-shares/:shareId` | read: `content:read` (with every task); change: `groups:manage`; `DELETE` is `409` once posted somewhere |
| POST | `/workspaces/:id/group-shares/:shareId/groups` | `groups:manage`; adds groups; duplicates and groups whose rules do not allow a share yet are reported in `skipped` |
| GET | `/workspaces/:id/sharing-tasks` | `content:read`; query `status` (`OPEN`, `DONE`, `SKIPPED`, `ALL`), `assignee` (`me`, `unassigned`, `available`, `any`), `shareId`, `groupId`; status `counts` |
| PATCH | `/workspaces/:id/sharing-tasks/:taskId` | `sharing_tasks:complete`; body `{ status?, postUrl?, note?, assigneeId? }`; `409` if the task changed meanwhile |

Non-members get `404` (not `403`) for workspace routes, so workspace IDs cannot be probed.

## Roles and permissions

| Capability                                              | Owner |       Admin       | Editor | Viewer |
| ------------------------------------------------------- | :---: | :---------------: | :----: | :----: |
| View workspace, members, accounts, content              |   ✓   |         ✓         |   ✓    |   ✓    |
| Create, schedule and publish content _(Phase 4)_        |   ✓   |         ✓         |   ✓    |        |
| Complete group-sharing tasks _(Phase 6)_                |   ✓   |         ✓         |   ✓    |        |
| Manage the group directory and group shares _(Phase 6)_ |   ✓   |         ✓         |        |        |
| View analytics _(Phase 7)_                              |   ✓   |         ✓         |   ✓    |   ✓    |
| Start an insights sync _(Phase 7)_                      |   ✓   |         ✓         |   ✓    |        |
| Invite members                                          |   ✓   | ✓ (editor/viewer) |        |        |
| Change roles, remove members, set account access        |   ✓   | ✓ (editor/viewer) |        |        |
| Connect, sync, reconnect, disconnect Meta logins        |   ✓   |         ✓         |        |        |
| View activity log                                       |   ✓   |         ✓         |        |        |
| Edit workspace settings                                 |   ✓   |         ✓         |        |        |
| Transfer ownership, delete workspace                    |   ✓   |                   |        |        |

Hierarchy rules:

- Members can only manage members of a strictly lower rank.
- OWNER is never assigned directly; it only moves by transfer.
- The database guarantees exactly one owner per workspace.
- Owners and admins always use every social account. Editors and viewers see and use
  only the accounts assigned to them; since Phase 3 they start with **none** until an
  owner or admin grants access, either per member, per account or in the invitation.

---

## Project history

| Date       | Phase                                             | Status                                                                                                                                                    |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | 1: Foundation                                     | Complete                                                                                                                                                  |
| 2026-11-20 | 2: Meta OAuth integration                         | Implemented and tested against the simulated Meta; **not complete** until verified with a real Meta app                                                   |
| 2026-11-20 | 2: Real-world verification preparation            | Evidence checker and runbook ready; verification **blocked** (no Meta app credentials yet)                                                                |
| 2026-11-20 | 3: Social account management                      | Implemented and tested with controlled data and the simulated Meta; real-Meta sync not yet verified                                                       |
| 2026-11-20 | 4 (frontend): Universal Post Composer             | Frontend implemented                                                                                                                                      |
| 2026-11-21 | 4 (backend): Composer drafts, media, presets      | Implemented and tested; S3 storage not yet run against a real bucket; publishing not built                                                                |
| 2026-11-21 | Combined follower totals                          | Implemented and tested against the simulated Meta; counts never read from a real Meta app yet                                                             |
| 2026-11-21 | Cross-phase integration audit                     | All automated checks pass; no real Meta app or real S3 bucket used                                                                                        |
| 2026-11-21 | Local media storage on `F:\Social Hub Data`       | Configured and verified with real uploads on the drive (25 live checks)                                                                                   |
| 2026-11-21 | 5: Publishing engine                              | Implemented and tested in simulation; **not complete**: queue not yet run on a real Redis, real publishing disabled                                       |
| 2026-11-21 | Public landing page                               | Implemented; checked in headless Chrome at desktop and phone widths; publishing shown as in development                                                   |
| 2026-11-21 | Account organisation                              | Implemented and tested (labels, stars, notes, All accounts tab, CSV export); SocialHub data only, no Meta calls                                           |
| 2026-11-21 | Followers on the Overview; class merging fix      | Implemented and tested; follower counts still only read from the simulated Meta                                                                           |
| 2026-11-21 | Draft privacy; 5: scheduling and composer Publish | Implemented and tested with mocks and the test-only queue; **Phase 5 not complete**: Redis still not installed                                            |
| 2026-11-23 | 6: Facebook Group distribution                    | Implemented and tested (directory, categories, tags, shares, manual tasks, duplicate and frequency rules); never contacts Facebook                        |
| 2026-11-23 | 5: Real Redis verification                        | Verified on Memurai 4.1.2 in simulation (queue 22/22, end to end 47/47, restarts 9/9 and 9/9); 4 problems found and fixed; real publishing still disabled |
| 2026-11-23 | 7: Analytics & Publishing Intelligence            | Implemented and tested; sync verified on a real Redis with demo data (34/34); **Meta insights not enabled and never run against Meta**                    |
| 2026-11-23 | Stabilization audit of Phases 5 and 7             | Cross-phase audit; no critical issues; 9 problems fixed with tests; still uncommitted, awaiting approval                                                  |
| 2026-11-23 | Pre-live security and reliability hardening       | Send-time authorization, job privacy, private queue status, safer recovery and shutdown; tested; still uncommitted, awaiting approval                     |
| 2026-11-23 | 8: Real Facebook and Instagram publishing         | Behind two switches (server `live`, workspace owner/admin + password); tested with a simulated Meta only; **not yet run on real accounts**                |
| 2026-11-23 | Upload fix and signed media links                 | Root cause found and fixed (absolute upload links blocked by the page's CSP); signed, expiring file links; tested; browser upload to be confirmed by hand |

### Upload fix and signed media links (2026-11-23)

**Symptom:** uploading in the composer failed with "The upload was interrupted. Check your
connection." **Cause:** with local storage the API returned upload links as absolute URLs on
`API_PUBLIC_URL` (the tunnel host). The page's Content-Security-Policy allows requests only to
its own origin (`connect-src 'self'`), so whenever SocialHub was open on another address
(`http://localhost:4000`, or a new tunnel host after a restart) the browser blocked the upload
before any byte was sent, and only reported a failed request.

- **Fix:** upload links and links for showing files are same-origin paths
  (`/api/v1/storage/…`), so they work on localhost, any tunnel and a domain. Only links handed
  to Meta are absolute, on `API_PUBLIC_URL`.
- **Stored files are no longer public by name:** every download link is signed for one file and
  expires (6 hours in SocialHub, 2 hours for Meta). Unsigned, tampered or other files' links
  get 404, expired ones 403 (JSON, never the web app).
- Uploads forwarded without `Content-Length` (chunked by a proxy) are accepted; the bytes
  received are still counted and must match.
- The composer says what went wrong: the storage's own message and request id, "too large"
  for 413, and which address did not answer.
- Retries reuse a still-valid upload slot (an "already uploaded" answer counts as delivered),
  so they no longer leave unused file records; a refused or expired slot, and the slot of an
  upload removed before it finished, are discarded.
- Tests: API media and storage links, chunked uploads; web upload errors and retries.

### Phase 8: Real Facebook and Instagram publishing (2026-11-23). Implemented, not verified live

Builds on the Phase 5 engine and its unverified adapters.

- **Switches:** `PUBLISHING_MODE=live` makes real publishing available on the server; each
  workspace stays simulated until an owner or admin switches it on (password and
  acknowledgement, `PUT /workspaces/:id/publishing/mode`, Settings › Publishing mode,
  activity entry `publishing.mode_changed`). A job's mode is fixed at creation; a live job is
  refused at send time if either switch was turned off, and cannot then be retried or
  rescheduled.
- **Checks before sending** (at creation and again in the worker): Meta's documented file
  rules per platform (`mediaIssues`), Instagram's 20-@mention limit, public HTTPS media
  (local storage counts when `API_PUBLIC_URL` is a public HTTPS address), Meta app
  configured, expired Instagram Login tokens, and Instagram's 24-hour publishing limit.
- **Confirmation:** nothing is reported as published without Meta's id. Facebook videos are
  confirmed through their processing status; the video id is saved so a later attempt checks
  the same video instead of uploading again.
- **Duplicates and errors:** server errors on the publishing call (without Meta's
  `is_transient`) and Meta's "unknown error" now count as "may have been published" and are
  not retried automatically; rate limits honour Meta's `estimated_time_to_regain_access`;
  Instagram's publishing-limit error waits an hour; Instagram `config_issue` becomes a
  warning on the published post.
- **Tests:** new `publishing.mode.test.js` and 19 new adapter tests against the simulated
  Meta; shared rule tests; Settings card tests. No test calls the real Graph API.
- **Still open:** a first real post of each kind with the owner's approval; whether Meta
  accepts `alt_text` on Instagram images and reports Facebook video `status` as expected;
  Meta App Review for publishing permissions. See
  [PUBLISHING_API.md, section 7](docs/PUBLISHING_API.md#7-real-publishing).

### Pre-live security and reliability hardening (2026-11-23)

Follow-up to the stabilization audit, before anything goes live. Real Meta publishing stays
disabled; everything below runs with the simulated adapter.

- **Authorization at send time:** just before a post is sent, SocialHub checks again that the
  member it relies on (the job's creator, or whoever last retried or rescheduled it) is still
  in the workspace, may still publish and may still use the account. If not, nothing is sent,
  the destination fails as `AUTHOR_NOT_AUTHORIZED` (never retried automatically) and the
  activity log says why. An admin can retry it, and the send then relies on the admin.
- **Job privacy:** a job made from a draft hidden from a member is hidden too, even when it
  was sent only to accounts the member may use (it shows the draft's caption). Lists,
  details, the summary, cancel, retry, reschedule and Analytics all answer as for an unknown
  id. The draft's accounts are recorded on the job when it is made.
- **Status privacy:** `/health` is public but only says whether the API and database are up;
  `/publishing/status` no longer shows members the server's queue counts, worker numbers or
  storage driver. Operators get those from `/health/details` with `HEALTH_DETAILS_TOKEN`.
- **Recovery:** the moment a post is handed to the platform is recorded, so a worker that
  stopped before it is safely queued again, while one that stopped after it stays
  "interrupted" for a person. Jobs whose status update failed are repaired by the sweep.
  Shutdown lets a post being published finish (up to 90 s, was 10 s).
- **Performance and polish:** sync status reads one index entry per account instead of the
  whole history; the posts CSV is one query; the composer refuses more than 100 accounts
  before saving and warns when hashtags would go in the (unsent) first comment; scheduled
  posts refresh once a minute until they are nearly due (was every 4 s); CSV file names work
  across origins; one shared job-visibility rule and one "Simulated" badge.
- Details: [docs/PUBLISHING_API.md](docs/PUBLISHING_API.md) sections 2, 3 and 5.

### Stabilization audit of Phases 5 and 7 (2026-11-23)

A cross-phase audit (security and isolation, web/API contracts, data integrity) of the
uncommitted publishing and analytics work, before committing it. No critical issue was found.
Fixed, each with a regression test:

- **Publishing:** when the platform has accepted a post but saving the result fails, the
  destination is never retried automatically: it is marked interrupted for a person to check.
  A failed job-status update can no longer leave a destination stuck. (Latent today: real
  publishing is disabled.)
- **Draft privacy:** a hidden draft's file could be reached by attaching its id to one's own
  draft, and deleting it answered 403 instead of 404 (revealing that it exists).
- **Captions:** the server repeated hashtags already written in the caption and counted only
  the hashtag list toward Instagram's 30; it now builds and checks a caption exactly as the
  composer previews it.
- **"Publish a draft"** failed with 422 when one of the draft's accounts had been removed;
  removed accounts are now left out, as the draft view does.
- **Analytics:** CSV exports began with the text "FEFF" instead of a byte order mark;
  negative numbers were exported as text; removing an account (including through Meta's
  data-deletion callback) left its insights and sync history behind; the incremental sync's
  lookup had no index; demo-mode wording; post dates now use the workspace time zone.
- **README:** Phase 5 status, known limitations and roadmap brought up to date.

Tests after the fixes: shared 99, API 732, web 1158; lint, formatting, the production build
and the 50-check smoke test pass. The Phase 5 commit was also checked on its own, without the
analytics changes, in a separate copy of the tree.

### Phase 7: Analytics & Publishing Intelligence (2026-11-23). Implemented; Meta insights not enabled

Briefed as "Phase 6"; recorded as Phase 7 because Phase 6 is the group-sharing workflow.

- **Screen:** `/w/:slug/analytics` ("Analytics" in the sidebar): publishing performance per
  mode (posts, deliveries, success rate, average time, retries, results per day), audience and
  engagement tiles with a per-day chart and table view, an accounts comparison, top posts with
  official links only, filters, CSV exports and "Sync insights". Responsive at 360 to 1440 px,
  light and dark.
- **API:** nine endpoints under `/workspaces/:id/analytics` (`analytics:read` for every role,
  `analytics:sync` for editors and above), each limited to the accounts the member may use.
  Indexed aggregations over three new collections (`AccountInsight`, `PostInsight`,
  `AnalyticsSyncRun`) and two new `PublishDestination` indexes.
- **Never fabricated:** unreported metrics are null ("Unavailable"), not 0; demo insights are
  stored as `SIMULATED` and never shown as Meta data; simulated and live publishing are never
  summed; simulated posts have no link.
- **Sync:** its own BullMQ queue (`socialhub-analytics`) carrying only run ids; one active run
  per account; retries with backoff; partial results kept; recovery of lost entries and
  interrupted runs. Verified on Memurai: `npm run analytics:verify -w @socialhub/api` 34/34.
- **Meta insights:** an adapter following Meta's documentation as of 2026-11-23 exists but has
  no switch, has only met a fake Meta, and needs `read_insights` / `instagram_manage_insights`
  (or the Instagram Login equivalent), which SocialHub does not request yet.
- **Found and fixed during browser checks:** a red "Failed 0" tile, "1 deliveries", and the
  accounts table adding simulated and live publishing together (now one line per mode).
- **Tests added:** shared +14, API +47 (`analytics.test.js` 25, `analytics.sync.test.js` 22),
  web +16 (`AnalyticsPage.test.jsx`). Suites now: shared 97, API 725, web 1156.
- Details: [docs/ANALYTICS.md](docs/ANALYTICS.md).

### Phase 6: Facebook Group distribution (2026-11-23). Implemented

A manual workflow for sharing posts in Facebook Groups. Meta's API no longer lets apps post in
groups, and SocialHub never automates or scrapes Facebook, so a person posts each share by hand
and SocialHub keeps the plan and the record. Nothing in this phase contacts Facebook.

- **Group sharing** section (`/w/:slug/groups`, "Group sharing" in the sidebar) with three tabs:
  - **Sharing tasks:** each person's queue with the text, the link, the group's rules, "Copy
    text", a link to the group, "Mark as shared" (with an optional link to the post), "Skip"
    and "Take it"; tabs for shared and skipped tasks.
  - **Shares:** a post written once for many groups, with progress per share; a share's page
    lists every group's task, who posts it, the result and the post link.
  - **Group directory:** groups with categories, relevance tags, approximate member count,
    rules and notes, and "days between shares"; search, filters, sorting, archive.
- **Duplicate prevention:** a share reaches each group at most once (unique `(share, group)`
  index), and a group whose "days between shares" has not passed gets no new task; skipped
  groups are reported with the reason and the date the next share is allowed.
- **Roles:** owners and admins (`groups:manage`) keep the directory and create shares; editors
  (`sharing_tasks:complete`) work on tasks assigned to them or to nobody; viewers can read.
  Open tasks of a member who leaves go back to "anyone". Deleting a workspace removes all of
  it. A group or share that was already posted somewhere can only be archived, so the history
  stays.
- **Not included:** shares do not read drafts from the composer (their text is entered on the
  Shares tab), and SocialHub cannot check that a post really appeared in the group.
- Details: [docs/GROUP_SHARING.md](docs/GROUP_SHARING.md).
- **Tests added:** API +15 (`groups.test.js`), shared +6 (`groups.test.js`), web +7
  (`features/groups/groups.test.jsx`).

### Followers on the Overview and class merging fix (2026-11-21)

- **Combined followers card:** a Facebook total, an Instagram total and a split bar showing
  each platform's share (Overview and Social accounts › Overview). On the Overview each
  figure also says "Across 6 Pages" or "4 of 6 Pages counted", and the card is now always
  shown: with no accounts it says so and links owners and admins to Connect accounts, and
  if the summary fails it shows an error with a retry instead of disappearing.
- **`cn()` fix** (`apps/web/src/lib/utils.js`): `cn()` now uses `tailwind-merge` 3.7.0 (new
  web dependency), so a later conflicting class wins. Before, Tailwind's stylesheet order
  decided: `FacebookIcon className="h-3.5 w-3.5"` still rendered at `h-5`, and conditional
  colours such as `cn('bg-white border-slate-200', active && 'bg-brand-50 border-brand-300')`
  never showed (selected cards, pressed toggles, active tabs and filters). Registered with
  it: the legacy `bg-gradient-to-*` names (otherwise read as background colours and
  dropped) and the custom `shadow-card`, `shadow-pop`, `animate-fade-in` and
  `animate-scale-in` tokens; `text-muted` merges as a text colour. Every class used in
  `apps/web/src` was checked for being misread as a colour.
- **Landing page:** the sample "Combined followers" card shows the same Facebook /
  Instagram split instead of a growth chart (the app does not store follower history).
- **Tests added:** web `utils.test.js` (8), `OverviewPage.test.jsx` (4) and 4 more in
  `FollowersCard.test.jsx`.

### Account organisation (2026-11-21). Implemented

Requested to make managing many Pages and accounts simpler. All of it is SocialHub data:
nothing here calls Meta, so it does not depend on the pending Meta verification.

- **All accounts tab** (`/w/:slug/accounts/all`): both platforms in one table, so bulk
  refresh, labels, team access and removal work across Facebook and Instagram at once.
- **Labels:** coloured workspace tags (100 per workspace, 20 per account). Filter, search,
  bulk add/remove, a label manager, a row-menu action and an "Edit labels" control on the
  account page. Owners and admins change them; everyone sees them.
- **Stars:** each person's own important accounts, a "Starred" filter and a "Your starred
  accounts" card on the Overview.
- **Team notes** on the account page (owners and admins edit, everyone who can see the
  account reads). The activity log records the change, never the text.
- **Sort by followers** (unknown counts always last), **CSV export** of the current filters
  (formula-safe cells, same access rules as the list), **Open on Facebook / Instagram** and
  **Copy Meta ID**.
- **Composer quick select:** "Post to" gains one-click chips for the person's starred
  accounts and for each label (adding them to the selection, or removing them when all are
  already selected); account rows show labels and stars, and search matches label names.
- **API changes:** account items gain `labels`, `starred` and `hasNotes`; the listing gains
  `label`, `starred` and the follower sorts, and its facets gain `labels` and `starred`.
  New endpoints and rules: [docs/ACCOUNT_ORGANIZATION.md](docs/ACCOUNT_ORGANIZATION.md).
- **Tests added:** API +22 (`accounts.organization.test.js`), shared +5
  (`accountLabels.test.js`), web +19 (`AccountOrganization.test.jsx` 13, composer 6). Existing tests that
  pin the exact list response and row menus were updated for the new fields and actions.

### Public landing page (2026-11-21)

- **Routes:** `/` shows the landing page to signed-out visitors (signed-in users still go to
  their last workspace or onboarding); `/welcome` shows it to everyone.
- **What it covers:** features, how it works, a tour of every app page, the composer, roles,
  security, how the Meta connection works, an honest roadmap and an FAQ. The copy lives in
  `apps/web/src/pages/landing/landingContent.js` and mirrors this README,
  `docs/ARCHITECTURE.md`, `META_SETUP_GUIDE.md` and the RBAC matrix. Update it when a feature
  ships, especially the roadmap statuses.
- **Honesty:** publishing and scheduling are shown as "In development"; product
  illustrations use labelled sample data; there are no customer logos, testimonials or usage
  figures.
- **Design:** always dark (independent of the app's theme toggle); CSS and SVG motion only
  (the CSP allows same-origin scripts only), switched off by `prefers-reduced-motion`; a
  lazy-loaded chunk of about 20 kB gzipped.
- **Verified:** 5 landing tests, the full web suite, lint, the production build, and
  screenshots in headless Chrome at 1440 px and 360 px. Not checked on real phones or in
  browsers other than Chrome.

### Phase 5: real Redis verification (2026-11-23). Verified in simulation

- **Redis:** Memurai Developer 4.1.2 (Redis API 7.2.5). Its Windows installer had failed on
  2026-11-21 (error 1603, not run as administrator), so with the user's agreement it was
  unpacked from the same installer (checksum matching winget's) and run as an ordinary
  process on `127.0.0.1:6379`, then stopped and removed after the checks. It is not installed
  on this machine now; `REDIS_URL` stays set in `apps/api/.env`, so the app reports the queue
  as unreachable until Redis is installed for good.
- **Real Redis, real BullMQ, real API and worker processes, MongoDB:** `queue:verify` 22/22;
  `publishing:verify` 47/47 (several accounts, partial failure, retries with backoff,
  duplicates, cancellation, uncertain outcome, clean stop, worker restart, killed worker,
  Redis data loss, connections cut, no tokens anywhere, no post ids); a Redis **server**
  restart while the API ran 9/9; a worker across a server restart 9/9. Meta was simulated
  throughout: nothing was sent to Facebook or Instagram.
- **Screens against the real API:** Publishing screen (every tab, worker stopped, Redis
  unreachable), "Change time" saved through the real API (new delayed entry in Redis), and
  the composer's Publish creating a real queued job, at 360, 768, 1024 and 1440 px, light
  and dark. A scheduled row's time now has its own line (its separators wrapped badly).
- **Found and fixed:** the queue could stay broken after starting before Redis was ready
  (`skipWaitingForReady`); the reconnection checks disconnected every client of the server;
  the token check flagged SocialHub's own sign-in token; the check's test accounts lacked
  permissions. Details in [docs/PUBLISHING_API.md](docs/PUBLISHING_API.md).
- **Phase 5 status:** complete for simulated publishing through a real Redis. Real Meta
  publishing remains disabled by design; it needs a verified Meta app with publishing
  permissions and public HTTPS media storage.

### Draft privacy and Phase 5 completion work (2026-11-21). Implemented; Phase 5 not complete

- **Draft privacy:** drafts and publishing jobs are now hidden from editors and viewers who
  cannot use every account on them (before, they saw the caption with the other accounts
  left out). Owners and admins see everything. Lists filter in the database query; reading,
  editing, deleting and publishing a hidden draft answer `404` like an unknown id. Drafts
  with no accounts follow the content permissions. Closes the open decision from the
  integration audit.
- **Scheduling:** a Scheduled tab (soonest first), "Change time" on scheduled posts
  (`PATCH /publish-jobs/:id/schedule`, safe against a worker that has just started), date,
  time and time-zone fields in the composer and in "Publish a draft", past and too-distant
  times refused. A scheduled post with one account cancelled now stays "Scheduled".
- **Composer Publish:** saves the draft, then creates the job for the selected accounts, now
  or scheduled; shows simulation warnings, blocking problems and the job's live status
  afterwards. Needs team drafts on. The unused `submitPost` stub (an endpoint that never
  existed) was removed.
- **Wording:** "isn't available yet" texts now say that _real_ publishing is not available;
  the landing page still says publishing is in development.
- **Redis:** still not installed (no service, nothing on port 6379, no Docker or WSL).
  `queue:verify` and `publishing:verify` stop with "REDIS_URL is not set". Memurai Developer
  4.1.2 is available through winget; installing it is the user's decision (see "Installing
  Redis").
- **Not done, so Phase 5 is not complete:** no run against a real Redis server, so no job
  has gone through the real BullMQ queue and worker; real publishing stays disabled.

### Phase 5: publishing engine (2026-11-21). Implemented in simulation; not complete

- **Built:** publish jobs with one record per account, BullMQ queue on Redis, worker,
  retries with exponential backoff, cancellation, idempotency keys, duplicate prevention,
  recovery after an interrupted worker, queue and worker health, activity entries, the
  Publishing screen, and adapters for Facebook Pages, Instagram and simulation.
- **Tests:** shared 68, API 593, web 1,070. Lint, formatting and the production build
  pass.
- **Run for real:** the API with no Redis and with Redis down (clear 503 and status, nothing
  queued); local media storage on the F: drive.
- **Not done, so the phase is not complete:**
  - The queue has not run against a real Redis server. None is installed here (no Docker,
    no WSL). `npm run queue:verify -w @socialhub/api` checks it once Redis is installed.
  - Because of that, no job has gone through the real queue end to end, and the Publishing
    screen has not been used against a live queue.
  - Real publishing is disabled. The Facebook and Instagram adapters have only met a
    simulated Meta.
- **Decisions to know about:**
  - Publishing starts from the Publishing screen, from saved team drafts. The composer's
    Publish button stays disabled.
  - First comments are not posted (the permissions are not requested); the account's result
    carries a note instead.
  - Scheduling is accepted by the API but has no screen yet.

### Local media storage on the F: drive (2026-11-21). Verified

- `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR="F:/Social Hub Data"`, outside the repository.
- No files existed in the old location, so nothing was moved or deleted.
- `npm run storage:verify-local` ran the real API against the real folder: image and video
  upload, files present on disk with identical content, verification, copy from `uploads`
  to `workspaces`, retrieval, API restart, deletion, clean-up, workspace separation and
  rejected paths. 25 of 25 checks passed. The test files are tiny generated JPEG and MP4
  files; the check removes them afterwards.

### Cross-phase integration audit (2026-11-21)

An audit of the combined work of the parallel sessions (Phases 1–4 and the follower totals),
on the uncommitted working tree.

- **Automated checks:** lint is clean, and 1,569 tests pass: shared 44, API 492 (24 files),
  web 1,033 (33 files). The web production build succeeds. A production-mode smoke test
  (real server process, in-memory MongoDB replica set) passes all 50 checks: auth, cookies,
  CSP, OAuth state handling, account management, and composer drafts (version
  conflicts, the 1 MB body limit on drafts only, `STORAGE_NOT_CONFIGURED`, audit entries).
  It also confirms the deploy step builds every collection's indexes.
- **Browser checks** (headless Chrome, production build, fixture API data): every screen,
  from sign-in to the composer, renders at 360 px without horizontal overflow, in light and
  dark themes. One regression was found and fixed. The new Followers column pushed the
  Instagram table's row actions out of view at 1280 px. Long table headers now wrap, and
  the per-account Followers column appears from about 1,360 px wide; the dashboards always
  show the totals. Earlier, the account filter bar's search box also collapsed at desktop
  widths; that is fixed too.
- **Integration and security review:**
  - The composer's drafts and presets use the account-management access filter, so a
    member can never target or see accounts outside their grant or their workspace.
  - Storage keys are server-generated and unguessable. Upload links are signed and bound
    to one key, type and size, and paths cannot escape the storage directory.
  - Follower counts that Meta did not return stay unknown ("—"), never 0, and a refused
    follower read never breaks a sync.
  - Findings were fixed by the owning session: local uploads are git-ignored, the local
    storage driver warns in production, the storage test seam refuses to run outside
    tests, and "not configured" errors log as warnings.
  - Open decision: drafts are readable by every role with `content:read`. Only the account
    IDs a reader cannot use are hidden. **Decided and implemented later the same day:**
    such drafts are now hidden entirely (see "Draft privacy and Phase 5 completion work").
- **Composer test timeouts (investigated):** two `ComposerPage` tests take about 3 s alone,
  because typing re-renders the whole composer on each keystroke. With every test file
  running in parallel they went past the 5 s default. They now have a 20 s budget.
- **Final baseline pass (same day, second reviewer):** every check was run again on the
  finished tree instead of trusting the earlier numbers.
  - **Results:** shared 44, API 494 (24 files), web 1,033 (33 files, 881 of them composer
    tests); `npm run lint` and `npm run format:check` clean; production build OK.
  - **Timeouts investigated:** six API tests had timed out at about 45 s each while three
    sessions ran test suites at once. On an otherwise idle machine the whole API suite passes
    at full parallelism in under a minute, so that was load and not a defect.
  - **Defect found and fixed:** with the local storage driver, an upload link stayed usable
    after its file had been verified, so the file could be replaced by other bytes of the
    same size. A link now writes one file once (`409` afterwards), with a regression test.
    The S3 driver has the same window in principle; see Known limitations.
  - **Also fixed:** expected `502`/`503` answers no longer appear as errors in the access
    log; the composer said the server features were "not available yet" although the API
    now exists (it now says they are not switched on); stale phase numbers in
    `apps/api/.env.example` and this README; two files failed `format:check`; in the composer, the media tiles' remove buttons drew on top of the sticky action bar.
  - **Reviewed with no defect found:** sign-in, refresh-token rotation and reuse detection,
    session revocation, password reset, the CSRF header and cookie settings, CORS, CSP,
    invitation acceptance, the one-owner rule, token encryption and hiding, workspace
    isolation and account restrictions on drafts, media and presets.
- **S3 overwrite fix (same day):** the audit's medium finding is fixed in code. Uploads go
  to a separate key; completion copies the file to a final key that no upload link can write
  to and verifies that copy. 19 new tests run the real S3 driver against a simulated
  provider (repeated upload, same-size replacement, expired link, swap during completion,
  simultaneous completions, outages, clean-up); 8 of them fail if the old single-key
  behaviour is restored. API suite: 513 tests. **Not run against a real bucket**; the new
  `storage:verify` script does that.
- **Not verified:** nothing has run against a real Meta app (`meta:verify`: 15 BLOCKED, no
  credentials, no HTTPS public URL) or a real S3 bucket. Phase 2, real-Meta sync, follower
  counts from Meta and S3 uploads therefore remain unverified.

### Combined follower totals (2026-11-21). Implemented; not yet read from a real Meta app

- **What it shows:** a "Combined followers" card on the workspace home and the Accounts
  overview: the total, plus Facebook Pages and Instagram subtotals and when the counts were
  read. The account tables have a Followers column. Members only see the totals for the
  accounts they can use. A destination that appears in several workspaces counts once in
  the "All my workspaces" view.
- **Where the numbers come from:** each destination's `followers_count`, read when it is
  added or synced, never on the selection screen. Pages and Page-linked Instagram accounts
  are read with `GET /{id}?fields=followers_count` and the Page token. That needs
  `pages_read_engagement`, plus `instagram_basic` for Instagram; logins without these
  permissions skip the read. Instagram Login accounts are read with
  `graph.instagram.com/me?fields=followers_count`.
- **Honest numbers:** a count Meta did not return is `null` and shows as "—", never 0. It
  is left out of the total, and the card says how many accounts are missing. The total is
  a sum per account, so a person who follows several accounts counts once for each.
- **Never breaks a sync:** reads are best effort, run 4 at a time, and must finish within
  30 s. They stop on a rate limit. A failed read keeps the last stored count and its
  timestamp. Accounts added before this change show "—" until their next sync.
- **API:** account items have `followersCount` and `followersCountUpdatedAt`. Both summary
  endpoints return a `followers` object: `total`, `facebook`, `instagram`, `counted`,
  `missing`, `facebookMissing`, `instagramMissing` and `asOf`.
- **Tests:** `apps/api/test/accounts.followers.test.js` (10 tests, simulated Meta) and
  `apps/web/src/components/accounts/FollowersCard.test.jsx` (5 tests).

### Phase 4 (backend): composer drafts, media and presets (2026-11-21). Implemented; publishing not built

- **Drafts API:** list, create, read, update and delete on
  `/workspaces/:id/content-packages`, stored in MongoDB (`ContentPackage`). Saves are guarded
  by a version number: a stale save answers `409` and writes nothing.
- **Media API:** upload links (`POST …/media/uploads`), direct upload to storage, and
  verification on `…/media/:mediaId/complete` (size, real file type, dimensions). Storage
  drivers: `s3` (S3-compatible) and `local` (development). Abandoned uploads and unused
  files are removed by `npm run media:cleanup`.
- **Account presets API:** list, create and delete on `/workspaces/:id/account-presets`
  (`AccountPreset`).
- **Rules everywhere:** workspace isolation, role permissions, and each member's account
  access. Activity is logged without post text.
- **Shared validation:** `packages/shared/src/composer.js` holds the limits and request
  schemas used by both the API and the composer.
- **Composer:** uses these APIs behind its three flags, autosaves existing team drafts,
  handles conflicts ("Save as a new draft"), and keeps the browser draft as a fallback.
- **Security policy:** the browser may connect to the configured storage origin and to no
  other external origin.
- **Not built:** publishing, scheduling, video thumbnails and transcoding.
- **Not verified:** the S3 driver against a real bucket (tests use a simulated provider).

### Phase 4 (frontend): Universal Post Composer (2026-11-20). Frontend implemented

- **Route:** `/w/:slug/compose`, linked as "Create post" in the sidebar for roles with `content:create`. Viewers see a no-permission state.
- **Composing:**
  - drag-and-drop images and videos, with client-side previews, dimensions and duration, reordering (drag or buttons) and alt text;
  - a caption shared by every platform or customized for Facebook or Instagram;
  - a hashtag editor that places hashtags at the end of the caption or in the first comment;
  - internal SEO keywords, stored with the post and never published;
  - a first comment.
- **Destinations:** multi-account selection with Facebook/Instagram filters, search, built-in presets and custom presets.
- **Preview and checks:** approximate Facebook and Instagram post previews, labelled "Not published", plus a readiness check against Meta's documented limits. The limits were researched and independently re-checked against Meta's official docs on 2026-11-20. Limits Meta doesn't document are only warnings.
- **Drafts:** autosave and "Save draft" in this browser only, scoped per user and workspace, with restore. Browser drafts are removed when the person signs out. If another tab changes the draft, the composer says so instead of showing "Saved".
- **Not built:**
  - Publishing: the Publish button is always disabled and nothing is sent to Meta.
  - Team drafts, media upload and shared presets are integration-ready behind `VITE_COMPOSER_SERVER_DRAFTS`, `VITE_COMPOSER_MEDIA_UPLOAD` and `VITE_COMPOSER_SERVER_PRESETS` (all off by default). The endpoints were added on 2026-11-21; see the Phase 4 (backend) entry.
  - [docs/COMPOSER_API_CONTRACT.md](docs/COMPOSER_API_CONTRACT.md) has the proposed API and the backend dependencies, including the new Meta permissions first comments need.
- **Code:** `apps/web/src/features/composer/`. Tests sit next to the code and run with `npm run test:web`.

### Phase 3: social account management (2026-11-20). Implemented; real-Meta sync not yet verified

Built on the existing `SocialConnection` / `SocialAccount` records; the only new
collection is the `SyncRun` history.

- **Dashboard (Overview tab).** Login, Page, Instagram, connected, expired, revoked and
  needs-attention totals with a readiness breakdown. A needs-attention list with the fix
  for each item. A searchable, filterable, sortable, paginated table of every account, and
  an "All my workspaces" scope.
- **Logins.** Identity cards with picture, status, connected date, last successful sync,
  token expiry and the Pages and Instagram accounts of each login. Actions: view details,
  choose accounts, sync, sync all (with per-login results), reconnect, disconnect, remove.
  A login detail page with permissions, accounts, the full sync history and activity.
- **Facebook Pages and Instagram tabs.** Tables with picture, ID or username, account
  type, linked Page, login, `CREATE_CONTENT` eligibility, readiness, status and last sync.
  Search, filters, sorting, pagination, row actions, and bulk refresh, access changes and
  removal.
- **Account detail.** Information, health and readiness reasons, the login and linked
  accounts, permissions and Page role, sync history, activity and team access.
- **Synchronization.** One lock per login, a recorded `SyncRun` for every attempt that
  reaches Meta, and outcomes for success, expired, revoked, removed permissions, rate
  limits and temporary failures. One retry for transient `GET` failures, sequential bulk
  sync that never aborts on a single failure, and a clear `409 META_NOT_CONFIGURED`
  instead of any result when Meta credentials are missing.
- **Health.** Readiness, `CREATE_CONTENT` eligibility and attention items are computed on
  every read from the current login state. An account lacking a publishing permission or
  the Page role is never ready.
- **Team access.** Least-privilege defaults: new editors, viewers and invitations start
  with no accounts. There is a per-member editor, per-account grant and revoke,
  invitations that grant accounts, and optimistic concurrency. Inaccessible accounts
  answer `404` on every route.
- **Deliberate behaviour changes** (documented in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#account-management-phase-3)):
  - new memberships default to no accounts instead of all;
  - a permission removed during sync marks the login `ERROR` instead of answering `502`;
  - sync refuses to run without Meta credentials;
  - the account-selection URL moved under `/accounts/logins/:id/select`, with a redirect
    from the old one.
- **Verification.**
  - 553 tests across shared (20), API (386) and web (147) pass; 160 of the API tests and
    108 of the web tests are new since Phase 2. Every Meta interaction in them is simulated
    (`fakeMeta.js`) or absent.
  - Lint is clean, the production build succeeds, and a production-mode smoke test passes
    (36 checks, 13 of them new: empty data stays empty, sync with no logins reports
    nothing, the new indexes are built on deploy, and the new routes are served).
  - Found and fixed during verification: a disconnect made while a sync was waiting for
    Meta could be undone by that sync. A login that changes during a sync now always wins.
  - **Not yet run against a real Meta app** (no credentials exist). Synchronization with
    real logins remains to be verified together with Phase 2.

### Phase 2: Meta OAuth integration (2026-11-20). Implemented; live verification pending

- **Configuration.**
  - Meta and Instagram app credentials, Graph API version (default v27.0), optional
    Facebook Login for Business `config_id`, scopes and `API_PUBLIC_URL`.
  - Validated at startup; the integration stays disabled until configured.
- **Meta client** (`src/integrations/meta`).
  - Official endpoints only, with `appsecret_proof` and timeouts.
  - Error classification: expired, revoked, permission denied, rate limited, transient.
  - Facebook: code and long-lived exchange, profile, permissions, `debug_token`,
    paginated `/me/accounts`, revocation.
  - Instagram Login: code exchange, long-lived exchange, refresh, profile.
  - `signed_request` verification.
- **OAuth flow.**
  - Hashed single-use state with browser-binding cookie and expiry.
  - Permission re-check on callback; cancel and error handling.
  - Reconnect with `auth_type=rerequest` and an identity-mismatch guard.
- **Connections and destinations.**
  - Multiple identities per workspace and live discovery.
  - Selection validated against Meta; duplicate-safe linking and re-linking.
  - Encrypted Page and Instagram tokens.
  - Publishing-readiness assessment from permissions and Page roles.
- **Health.**
  - Effective status from token and data-access expiry; manual and scheduled sync
    (`meta:sync`).
  - Instagram token refresh; lost-access detection.
  - Deauthorize and data-deletion callbacks with a deletion status endpoint.
- **Disconnection.** Disconnect, remove and per-account removal. Member access lists are
  cleaned. Revocation at Meta only when the identity is unused elsewhere. Workspace
  deletion releases unused authorizations.
- **Audit.** New activity events for connections and accounts.
- **Dashboard.**
  - Connect Facebook / Instagram, connected logins with health, expiry and
    missing-permission details.
  - Choose-accounts screen with duplicate states, reconnect flows, an OAuth result page,
    account removal.
  - Honest messaging when Meta isn't configured; publishing still described as
    unavailable.
- **Review against Meta's current docs** (same day; full notes in
  [META_SETUP_GUIDE.md](META_SETUP_GUIDE.md)):
  - OAuth error 467 is "invalid token" (→ `REVOKED`), and a bare 190 means expired.
  - Rate-limit codes are limited to the documented set (plus 368).
  - Picture fields use the documented `picture.width().height()` form.
  - Publishing readiness requires the `CREATE_CONTENT` Page task.
  - `business_management` is no longer requested by default, and the unsupported
    "portfolio Pages may be missing" warning is gone.
  - Instagram callbacks accept either app secret and either id.
  - A configuration review was added to `GET /api/v1/integrations/meta`.
- **Real-world verification preparation.**
  - A read-only evidence checker, `npm run meta:verify -w @socialhub/api -- --live --log api.log`.
  - A runbook in [docs/PHASE2_VERIFICATION.md](docs/PHASE2_VERIFICATION.md).
  - Baseline against the real `.env`: **15 BLOCKED**. No Meta app credentials or HTTPS public URL are configured yet, and there are no workspaces or connections.
- **Verification.**
  - 284 automated tests in total, all passing.
  - Mutation checks on key OAuth and duplicate protections.
  - A production-mode smoke test.
  - **Not yet tested against a real Meta Developer App.**

### Phase 1: foundation (2026-11-19)

The repository started empty. Phase 1 delivered:

- **Monorepo and configuration.**
  - npm workspaces, ESLint (zero-warning policy), Prettier and EditorConfig.
  - docker-compose, a secrets generator and Zod-validated environment config.
- **MongoDB.** Transactions with standalone fallback, index sync script, graceful
  shutdown, and a health endpoint.
- **Authentication.**
  - Registration, login, logout and logout-all.
  - Rotating refresh tokens with reuse detection and multi-tab race handling.
  - Password reset and change, rate limiting, timing-safe login.
- **Workspaces.** Create, update, delete (cascade), ownership transfer with
  re-authentication, overview.
- **Membership and RBAC.**
  - The shared permission matrix with role hierarchy.
  - Invitations with single-use acceptance, role changes, removal, leaving, and
    per-member account access.
- **Activity log.** Written in the same transaction as each change.
- **Social data model.** `SocialConnection` / `SocialAccount` with encrypted,
  never-serialised tokens.
- **Dashboard.** All core pages, light and dark themes, responsive and accessible.
- **Verification.** 163 tests, production build, production-mode smoke test.

## Roadmap

| Phase                     | Status                                                           | Scope                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Foundation**         | Complete                                                         | Auth, workspaces, RBAC, invitations, activity, dashboard.                                                                                                                                                                                                                                                                             |
| **2: Meta integration**   | Implemented; awaiting live Meta testing                          | Official Facebook Login and Instagram Login; multiple identities; Page and Instagram discovery and selection; token health, reauthorization, disconnection; Meta callbacks.                                                                                                                                                           |
| **3: Account management** | Implemented; real-Meta sync not yet verified                     | Dashboard, logins, Facebook Pages and Instagram views; detail pages; synchronization with history; least-privilege team access.                                                                                                                                                                                                       |
| **4: Composer**           | Implemented                                                      | Universal composer (media upload, multi-destination select, caption, hashtags, SEO keywords, first comment, alt text, per-destination overrides, preview), team drafts, media storage, account presets.                                                                                                                               |
| **5: Publishing engine**  | Implemented and verified in simulation; real publishing disabled | BullMQ engine with one record per destination: idempotent, exponential backoff, permanent-error classification, accurate partial success, Publishing screen, scheduling, composer Publish, draft privacy; queue verified on a real Redis. Open: real publishing (needs Meta credentials, permissions and public HTTPS media storage). |
| **6: Group distribution** | Implemented                                                      | Manual Facebook Group sharing workflow: directory, categories, relevance tags, sharing tasks and links, completion tracking, duplicate prevention. No automation or scraping.                                                                                                                                                         |
| **7: Analytics**          | Implemented; Meta insights not enabled                           | Publishing performance per mode, insights per source with coverage, accounts comparison, top posts, CSV exports, insights sync queue. Open: Meta insights permissions, App Review and a verified live adapter.                                                                                                                        |

## Known limitations

- **Nothing is sent to Facebook or Instagram.** Real publishing is disabled; the publishing
  engine only runs in simulation. See [Publishing engine](#publishing-engine).
- **Redis has only been run locally.** The publishing and analytics queues were verified on
  Memurai 4.1.2 on this development machine (2026-11-23); no hosted or production Redis has
  been set up.
- **Insights are never read from Meta yet.** Analytics shows SocialHub's publishing records
  and, in development, labelled demo insights. Reading Meta insights needs new permissions and
  App Review; see [docs/ANALYTICS.md](docs/ANALYTICS.md#6-meta-insights-not-enabled).
- **Media is stored on the local drive** (`F:\Social Hub Data`). Meta cannot fetch it, so real
  publishing will need public HTTPS storage first. The folder is not backed up by SocialHub.
- First comments are not posted.
- **The S3 overwrite fix is not verified on a real bucket.** Uploads now go to a separate
  key and are copied to a final key before verification, so an upload link can no longer
  change a verified file. This is proven against a simulated provider only. Run
  `npm run storage:verify -w @socialhub/api` against your bucket to confirm it.
- **S3 media URLs are public to anyone who has the link.** Meta must be able to fetch media, so
  S3 objects are readable without signing in. Keys are long random strings; keep bucket
  listing disabled. With local storage every link is signed for one file and expires (6 hours
  in SocialHub, 2 hours for Meta).
- The per-account Followers column is hidden below about 1,360 px; the totals always show.
- **S3 media storage has not been run against a real bucket.** Only the local-disk driver
  has been exercised for real.
- **No video thumbnails or transcoding.** Videos have no preview image in draft lists, MOV is
  not converted for Facebook, and non-JPEG images are not converted for Instagram.
- Media clean-up is a script to schedule yourself (the publish worker does not run it).

- **Phase 2 has not been run against a real Meta Developer App.** The Meta behaviour in
  tests is simulated from the official documentation. See the live verification checklist
  above.
- **Phase 3 synchronization has only run against the simulated Meta.** The management
  views work on real records, but no real login exists until Phase 2 is verified with a
  Meta app.
- Account lists are filtered and sorted in memory, over at most 5,000 visible accounts
  per request. Responses say `truncated` beyond that.
- "Sync all" contacts Meta for each login in turn, inside one request. With many logins
  it can take long enough for a proxy to time out (each login's result is still saved).
  A background job replaces it in Phase 4.
- The team-access editors list at most the first 500 accounts of a workspace.
- No publishing or scheduling yet (Phase 4).
- No email verification at sign-up, and email addresses cannot be changed. Password reset
  works.
- Rate limiting is per API instance (in-memory).
- Scheduled Meta sync is a CLI script to run from cron until Phase 4 adds BullMQ.
- Without SMTP configured, no email is sent. Invitation links can still be shared
  manually from the UI. Password reset needs SMTP in production; in development the reset
  link appears in the API log.
- The UI has been checked by component tests and a production build. It has not had
  manual visual QA in real browsers yet.
