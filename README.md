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
> - **Phase 4 (composer): frontend and backend implemented; publishing not built.** The
>   composer (`/w/:slug/compose`) can save team drafts, upload media and share account
>   presets through the API. Those three features are switched on per deployment (see
>   [Composer backend](#composer-backend)), and media upload needs storage to be configured.
>   The S3 storage driver has not been run against a real bucket yet.
> - **Publishing and scheduling are not implemented.** The Publish button stays disabled and
>   nothing is ever sent to Facebook or Instagram.

- [Architecture and data model](docs/ARCHITECTURE.md)
- **[Phase 2 real-world verification runbook](docs/PHASE2_VERIFICATION.md)**: what to do with your Meta app and test accounts, and how results are verified
- [Meta integration](#meta-integration)
- [Social account management](#social-account-management)
- [Composer backend](#composer-backend): drafts, media storage and account presets
- [Composer API contract](docs/COMPOSER_API_CONTRACT.md)
- **[Meta setup guide](META_SETUP_GUIDE.md)**: step-by-step Meta Developer Dashboard setup,
  with notes on which facts were checked against Meta's docs
- [Project history](#project-history)
- [Roadmap](#roadmap)

---

## Tech stack

| Layer   | Technology                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Web     | React 19, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, React Hook Form + Zod                 |
| API     | Node.js ≥ 20.19, Express 5, Mongoose 9 (MongoDB), Zod 4, pino                                             |
| Auth    | bcrypt passwords, short-lived JWT in memory, rotating httpOnly refresh cookie                             |
| Meta    | Facebook Login (Graph API, default v27.0) and Instagram API with Instagram Login; official endpoints only |
| Shared  | `@socialhub/shared`: RBAC matrix, domain enums and validation schemas used by both apps                   |
| Tests   | Vitest 5, Supertest, mongodb-memory-server (replica set), Testing Library                                 |
| Planned | Redis + BullMQ publishing engine (Phase 4)                                                                |

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

| Command                                                         | What it does                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                   | Starts the API (watch mode) and web dev server together                                                                |
| `npm run dev:api` / `npm run dev:web`                           | Starts one side only                                                                                                   |
| `npm test`                                                      | Runs all test suites (shared, API, web)                                                                                |
| `npm run lint`                                                  | ESLint across the monorepo; fails on any warning                                                                       |
| `npm run build`                                                 | Production build of the web app to `apps/web/dist`                                                                     |
| `npm run verify`                                                | `lint` + `test` + `build`: the pre-merge gate                                                                          |
| `npm start`                                                     | Starts the API in production mode                                                                                      |
| `npm run secrets`                                               | Generates fresh secrets for `.env`                                                                                     |
| `npm run format` / `format:check`                               | Prettier                                                                                                               |
| `npm run db:indexes -w @socialhub/api`                          | Builds or reconciles MongoDB indexes; run this on deploy                                                               |
| `npm run meta:sync -w @socialhub/api`                           | Re-validates every Meta connection and records each run in its sync history; schedule it daily (e.g. cron)             |
| `npm run meta:verify -w @socialhub/api -- --live --log api.log` | Read-only, evidence-based check of the Phase 2 real-world checklist (never prints tokens)                              |
| `npm run media:cleanup -w @socialhub/api`                       | Removes abandoned uploads and stored files no draft uses; schedule it (e.g. hourly)                                    |
| `npm run storage:verify -w @socialhub/api`                      | Checks the configured S3 bucket with real requests: upload, copy, public delivery, link reuse, CORS, listing, deletion |

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

### Testing against a real Meta app locally

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

| `STORAGE_DRIVER` | Use              | Notes                                                                                          |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| _(empty)_        | Uploads disabled | Upload requests answer `503 STORAGE_NOT_CONFIGURED`                                            |
| `local`          | Development      | Files in `apps/api/storage-data`, served by the API. Instagram cannot fetch them from a laptop |
| `s3`             | Production       | Any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO)                                        |

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

| Suite  | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared | 44    | RBAC matrix and hierarchy rules; validation schemas; composer limits and request schemas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| api    | 513   | Phase 1: auth, sessions, refresh rotation, password flows, workspaces, roles, members, invitations, activity, config, security headers (CSP), CORS, redaction. Phase 2: OAuth state and callback validation, browser binding, cancellation, permission re-check, reauthorization and identity mismatch, Instagram Login, multiple connections, multi-Page pagination, selection, duplicates, encryption and no token leakage, permissions, workspace isolation, expired and revoked tokens, declined permissions, lost Page roles, Instagram refresh, sync, disconnect, remove, deauthorize and data-deletion callbacks, Graph error classification. Phase 3 (simulated Meta and controlled data): multiple logins and Pages per login, independent records, duplicate prevention, listing filters, sorting, pagination, facets and summaries, cross-workspace listing, workspace isolation, role-based visibility, Instagram management, sync outcomes and history, sync lock and races with disconnect, reconnect and removal, transient-failure retry, missing Meta configuration, disconnection and removal, CREATE_CONTENT eligibility, least-privilege team access, invitation grants, hierarchy and optimistic concurrency, health rules. Follower totals (simulated Meta). Phase 4: draft CRUD, version conflicts and simultaneous saves, autosave runs, paging, workspace isolation, roles and account restrictions, media upload slots, file validation, real file-type and dimension checks, storage outages, abandoned-upload clean-up, upload links that cannot overwrite a verified file, account presets and duplicate names, activity entries, S3 request signing (Amazon's documented example) and the S3 driver against a simulated provider |
| web    | 1,033 | API client, route guards, login, onboarding, permission-gated UI; Phase 2: connect and redirect, reconnect, account selection with duplicates locked, reconnect-required state, OAuth result messages, malformed result URLs; Phase 3: dashboard figures and scopes, needs-attention fixes, filters sent to the API, logins with sync, reconnect, disconnect and remove, login and account detail pages, Pages and Instagram tables with bulk refresh, access and removal, sync results, setup-required state, team access editing (PATCH and PUT), invitation account grants, role-based visibility; follower totals; Phase 4 composer (881 of these): editors, media, account selection and presets, previews, readiness checks, browser drafts, team drafts with autosave and conflicts, uploads, session expiry, request bodies checked against the shared schemas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Counts are from the final Phase 1–4 audit on 2026-11-21. Tests of the S3 storage driver use
a simulated provider: **no test talks to a real bucket.**

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
| GET    | `/health`                                            | public; `503` if the database is down                                                                                                                                                                |

**Composer (Phase 4)**

| Method    | Path                                                   | Permission / notes                                                                        |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| GET       | `/workspaces/:id/content-packages?status&cursor&limit` | `content:read`; drafts, newest first                                                      |
| POST      | `/workspaces/:id/content-packages`                     | `content:create`; creates a draft (version 1)                                             |
| GET       | `/workspaces/:id/content-packages/:packageId`          | `content:read`                                                                            |
| PATCH     | `/workspaces/:id/content-packages/:packageId`          | `content:create`; full save with `version`; `409` when stale                              |
| DELETE    | `/workspaces/:id/content-packages/:packageId`          | `content:create`                                                                          |
| POST      | `/workspaces/:id/media/uploads`                        | `content:create`; body `{ fileName, mimeType, sizeBytes, kind }`; returns the upload link |
| POST      | `/workspaces/:id/media/:mediaId/complete`              | `content:create`; verifies the stored file; `409 UPLOAD_INCOMPLETE` if it has not arrived |
| GET       | `/workspaces/:id/media/:mediaId`                       | `content:read`                                                                            |
| DELETE    | `/workspaces/:id/media/:mediaId`                       | `content:create`; uploader or admin; `409` while a draft uses it                          |
| GET       | `/workspaces/:id/account-presets`                      | `content:read`                                                                            |
| POST      | `/workspaces/:id/account-presets`                      | `content:create`; body `{ name, socialAccountIds }`; `409` for a duplicate name           |
| DELETE    | `/workspaces/:id/account-presets/:presetId`            | `content:create`; creator or admin                                                        |
| PUT / GET | `/storage/uploads/:token`, `/storage/objects/*`        | Only with `STORAGE_DRIVER=local`: upload target and file serving                          |

Non-members get `404` (not `403`) for workspace routes, so workspace IDs cannot be probed.

## Roles and permissions

| Capability                                       | Owner |       Admin       | Editor | Viewer |
| ------------------------------------------------ | :---: | :---------------: | :----: | :----: |
| View workspace, members, accounts, content       |   ✓   |         ✓         |   ✓    |   ✓    |
| Create, schedule and publish content _(Phase 4)_ |   ✓   |         ✓         |   ✓    |        |
| Complete group-sharing tasks _(Phase 5)_         |   ✓   |         ✓         |   ✓    |        |
| Invite members                                   |   ✓   | ✓ (editor/viewer) |        |        |
| Change roles, remove members, set account access |   ✓   | ✓ (editor/viewer) |        |        |
| Connect, sync, reconnect, disconnect Meta logins |   ✓   |         ✓         |        |        |
| View activity log                                |   ✓   |         ✓         |        |        |
| Edit workspace settings                          |   ✓   |         ✓         |        |        |
| Transfer ownership, delete workspace             |   ✓   |                   |        |        |

Hierarchy rules:

- Members can only manage members of a strictly lower rank.
- OWNER is never assigned directly; it only moves by transfer.
- The database guarantees exactly one owner per workspace.
- Owners and admins always use every social account. Editors and viewers see and use
  only the accounts assigned to them; since Phase 3 they start with **none** until an
  owner or admin grants access, either per member, per account or in the invitation.

---

## Project history

| Date       | Phase                                        | Status                                                                                                          |
| ---------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | 1: Foundation                                | Complete                                                                                                        |
| 2026-11-20 | 2: Meta OAuth integration                    | Implemented and tested against the simulated Meta; **not complete** until verified with a real Meta app         |
| 2026-11-20 | 2: Real-world verification preparation       | Evidence checker and runbook ready; verification **blocked** (no Meta app credentials yet)                      |
| 2026-11-20 | 3: Social account management                 | Implemented and tested with controlled data and the simulated Meta; real-Meta sync not yet verified             |
| 2026-11-20 | 4 (frontend): Universal Post Composer        | Frontend implemented                                                                                            |
| 2026-11-21 | 4 (backend): Composer drafts, media, presets | Implemented and tested; S3 storage not yet run against a real bucket; publishing not built                      |
| 2026-11-21 | Combined follower totals                     | Implemented and tested against the simulated Meta; counts never read from a real Meta app yet                   |
| 2026-11-21 | Cross-phase integration audit                | All automated checks pass; no real Meta app or real S3 bucket used                                              |
| 2026-11-21 | Account organisation                         | Implemented and tested (labels, stars, notes, All accounts tab, CSV export); SocialHub data only, no Meta calls |
| 2026-11-21 | Followers on the Overview; class merging fix | Implemented and tested; follower counts still only read from the simulated Meta                                 |

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
    IDs a reader cannot use are hidden.
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

| Phase                          | Status                                       | Scope                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Foundation**              | Complete                                     | Auth, workspaces, RBAC, invitations, activity, dashboard.                                                                                                                                                                                                                                                               |
| **2: Meta integration**        | Implemented; awaiting live Meta testing      | Official Facebook Login and Instagram Login; multiple identities; Page and Instagram discovery and selection; token health, reauthorization, disconnection; Meta callbacks.                                                                                                                                             |
| **3: Account management**      | Implemented; real-Meta sync not yet verified | Dashboard, logins, Facebook Pages and Instagram views; detail pages; synchronization with history; least-privilege team access.                                                                                                                                                                                         |
| **4: Composer and publishing** | Composer implemented; publishing not started | Universal composer (media upload, multi-destination select, caption, hashtags, SEO keywords, first comment, alt text, per-destination overrides, preview, schedule). BullMQ engine with one `PublishingJob` per destination: idempotent, exponential backoff, permanent-error classification, accurate partial success. |
| **5: Group distribution**      | Not started                                  | Manual Facebook Group sharing workflow: directory, categories, relevance tags, sharing tasks and links, completion tracking, duplicate prevention. No automation or scraping.                                                                                                                                           |

## Known limitations

- **No publishing or scheduling.** The composer saves drafts, media and presets; nothing is
  sent to Facebook or Instagram.
- **The S3 overwrite fix is not verified on a real bucket.** Uploads now go to a separate
  key and are copied to a final key before verification, so an upload link can no longer
  change a verified file. This is proven against a simulated provider only. Run
  `npm run storage:verify -w @socialhub/api` against your bucket to confirm it.
- **Media URLs are public to anyone who has the link.** Meta must be able to fetch media, so
  objects are readable without signing in. Keys are long random strings; keep bucket listing
  disabled.
- **Drafts are readable by every role that can read content,** including viewers and members
  restricted to other accounts. Only the account list is filtered per reader.
- The per-account Followers column is hidden below about 1,360 px; the totals always show.
- **S3 media storage has not been run against a real bucket.** Only the local-disk driver
  has been exercised for real.
- **No video thumbnails or transcoding.** Videos have no preview image in draft lists, MOV is
  not converted for Facebook, and non-JPEG images are not converted for Instagram.
- Media clean-up is a script to schedule yourself until the BullMQ worker exists.

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
