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
> - **Publishing and scheduling are not implemented** (Phase 4). The app says so wherever
>   they would appear and never simulates them. The Phase 4 composer frontend exists
>   (`/w/:slug/compose`), but its Publish button stays disabled; see the
>   [project history](#project-history).

- [Architecture and data model](docs/ARCHITECTURE.md)
- **[Phase 2 real-world verification runbook](docs/PHASE2_VERIFICATION.md)**: what to do with your Meta app and test accounts, and how results are verified
- [Meta integration](#meta-integration)
- [Social account management](#social-account-management)
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

| Command                                                         | What it does                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                   | Starts the API (watch mode) and web dev server together                                                    |
| `npm run dev:api` / `npm run dev:web`                           | Starts one side only                                                                                       |
| `npm test`                                                      | Runs all test suites (shared, API, web)                                                                    |
| `npm run lint`                                                  | ESLint across the monorepo; fails on any warning                                                           |
| `npm run build`                                                 | Production build of the web app to `apps/web/dist`                                                         |
| `npm run verify`                                                | `lint` + `test` + `build`: the pre-merge gate                                                              |
| `npm start`                                                     | Starts the API in production mode                                                                          |
| `npm run secrets`                                               | Generates fresh secrets for `.env`                                                                         |
| `npm run format` / `format:check`                               | Prettier                                                                                                   |
| `npm run db:indexes -w @socialhub/api`                          | Builds or reconciles MongoDB indexes; run this on deploy                                                   |
| `npm run meta:sync -w @socialhub/api`                           | Re-validates every Meta connection and records each run in its sync history; schedule it daily (e.g. cron) |
| `npm run meta:verify -w @socialhub/api -- --live --log api.log` | Read-only, evidence-based check of the Phase 2 real-world checklist (never prints tokens)                  |

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
| `pages_manage_posts`                 | Facebook  | Publishing to Pages (used in Phase 3)                                        | Yes                      |
| `instagram_basic`                    | Facebook  | Reads Instagram professional accounts linked to Pages                        | Yes                      |
| `instagram_content_publish`          | Facebook  | Publishing to Page-linked Instagram accounts (Phase 3)                       | Yes                      |
| `instagram_business_basic`           | Instagram | **Required** for Instagram Login; reads the account and allows token refresh | Yes, for Advanced Access |
| `instagram_business_content_publish` | Instagram | Publishing with Instagram Login (Phase 3)                                    | Yes                      |

Scopes are configurable (`META_FACEBOOK_SCOPES`, `INSTAGRAM_SCOPES`). With
`META_FACEBOOK_LOGIN_CONFIG_ID` set, Facebook Login for Business uses that configuration's
permissions instead.

**Optional, not requested by default:**

- `business_management`: Meta documents it for Business Manager API use cases, not for
  listing Pages.
- `ads_management` and `ads_read`: Meta's content-publishing guide requires them for
  publishing to Instagram when the person's Page role comes from Business Manager
  (Phase 3).

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

---

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

| Suite  | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared | 20    | RBAC matrix and hierarchy rules; validation schemas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| api    | 225   | Phase 1: auth, sessions, refresh rotation, password flows, workspaces, roles, members, invitations, activity, config, security headers, CORS, redaction. Phase 2: OAuth state and callback validation, browser binding, cancellation, permission re-check, reauthorization and identity mismatch, Instagram Login, multiple connections, multi-Page pagination, selection, duplicates, encryption and no token leakage, permissions, workspace isolation, expired and revoked tokens, declined permissions, lost Page roles, Instagram refresh, sync, disconnect, remove, deauthorize and data-deletion callbacks, Graph error classification |
| web    | 39    | API client, route guards, login, onboarding, permission-gated UI; Phase 2: connect and redirect, reconnect, expiry warnings, editor view, account selection with duplicates locked, reconnect-required state, OAuth result messages, malformed result URLs                                                                                                                                                                                                                                                                                                                                                                                    |

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
- **Security headers:** Helmet CSP (`script-src 'self'`, no inline scripts),
  `upgrade-insecure-requests` in production, HSTS, `nosniff` and frame protection. Access
  logs never include headers, invitation tokens or OAuth codes.

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

| Date       | Phase                                  | Status                                                                                                  |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-11-19 | 1: Foundation                          | Complete                                                                                                |
| 2026-11-20 | 2: Meta OAuth integration              | Implemented and tested against the simulated Meta; **not complete** until verified with a real Meta app |
| 2026-11-20 | 2: Real-world verification preparation | Evidence checker and runbook ready; verification **blocked** (no Meta app credentials yet)              |
| 2026-11-20 | 3: Social account management           | Implemented and tested with controlled data and the simulated Meta; real-Meta sync not yet verified     |
| 2026-11-20 | 4 (frontend): Universal Post Composer  | Frontend implemented; backend APIs and publishing not built                                             |

### Phase 4 (frontend): Universal Post Composer (2026-11-20). Frontend implemented; backend APIs not built

- **Route:** `/w/:slug/compose`, linked as "Create post" in the sidebar for roles with `content:create`. Viewers see a no-permission state.
- **Composing:**
  - drag-and-drop images and videos, with client-side previews, dimensions and duration, reordering (drag or buttons) and alt text;
  - a caption shared by every platform or customized for Facebook or Instagram;
  - a hashtag editor that places hashtags at the end of the caption or in the first comment;
  - internal SEO keywords, stored with the post and never published;
  - a first comment.
- **Destinations:** multi-account selection with Facebook/Instagram filters, search, built-in presets and custom presets.
- **Preview and checks:** approximate Facebook and Instagram post previews, labelled "Not published", plus a readiness check against Meta's documented limits. The limits were researched and independently re-checked against Meta's official docs on 2026-11-20. Limits Meta doesn't document are only warnings.
- **Drafts:** autosave and "Save draft" in this browser only, scoped per user and workspace, with restore.
- **Not built:**
  - Publishing: the Publish button is always disabled and nothing is sent to Meta.
  - Team drafts, media upload and shared presets are integration-ready behind `VITE_COMPOSER_SERVER_DRAFTS`, `VITE_COMPOSER_MEDIA_UPLOAD` and `VITE_COMPOSER_SERVER_PRESETS` (all off by default). They target endpoints that don't exist yet.
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
| **4: Composer and publishing** | Frontend implemented; backend not started    | Universal composer (media upload, multi-destination select, caption, hashtags, SEO keywords, first comment, alt text, per-destination overrides, preview, schedule). BullMQ engine with one `PublishingJob` per destination: idempotent, exponential backoff, permanent-error classification, accurate partial success. |
| **5: Group distribution**      | Not started                                  | Manual Facebook Group sharing workflow: directory, categories, relevance tags, sharing tasks and links, completion tracking, duplicate prevention. No automation or scraping.                                                                                                                                           |

## Known limitations

- **Phase 2 has not been run against a real Meta Developer App.** The Meta behaviour in
  tests is simulated from the official documentation. See the live verification checklist
  above.
- **Phase 3 synchronization has only run against the simulated Meta.** The management
  views work on real records, but no real login exists until Phase 2 is verified with a
  Meta app.
- Account lists are filtered and sorted in memory, over at most 5,000 visible accounts
  per request. Responses say `truncated` beyond that.
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
