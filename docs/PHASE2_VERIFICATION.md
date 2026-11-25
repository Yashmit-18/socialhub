# Phase 2: real-world Meta verification runbook

Phase 2 (Meta OAuth) stays **incomplete** until this runbook has been carried out with a
real Meta Developer App and real authorized test accounts, and the verifier reports
**PASS** for items 4–15.

## Rules

- **Logins are yours.** Meta's consent screens require you to sign in yourself. SocialHub
  never automates Facebook or Instagram login.
- **Results come from evidence.** `npm run meta:verify -w @socialhub/api` decides each item
  from three sources:
  - what is actually stored;
  - what Meta actually returns for the stored tokens (`--live`);
  - your captured server log (`--log`).

  It is **read-only**: it never writes to the database, never calls a Meta endpoint that
  changes anything, and never prints a token or secret. Its output is safe to share.

- **Statuses.**
  - `PENDING`: the step that produces the evidence hasn't been done yet.
  - `BLOCKED`: configuration is missing.
  - `FAIL`: the evidence contradicts the claim.

## Baseline (2026-11-20, before any Meta app was configured)

`npm run meta:verify -w @socialhub/api -- --live --log <boot log>` against the real
`apps/api/.env` reported **15 BLOCKED**:

- `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` and
  `API_PUBLIC_URL` are empty.
- The public URL resolves to `http://localhost:5173` (not HTTPS).
- The database has no workspaces or connections yet.

Other baseline results:

- The API booted with that `.env`, connected to MongoDB with transactions, and rejected
  anonymous Meta endpoint calls with 401.
- The boot log contained no tokens or secrets.

## What you need first

1. **A Meta app** configured per [META_SETUP_GUIDE.md](META_SETUP_GUIDE.md): Facebook
   Login (for Business), Require App Secret, and the callback URLs.
2. **Test accounts**, all with a **role on the app** (App roles → Roles). In Development
   mode nobody else can authorize.
   - **Facebook user A**: admin of **at least 2 Pages**.
   - **Facebook user B**: admin of **at least 1 Page**. It may share one Page with A, which
     also exercises duplicate protection.
   - **One of those Pages** linked to an **Instagram Business or Creator account**.
   - _Optional:_ an **Instagram professional account** added as an Instagram tester, to
     test Instagram Login directly.
3. **An HTTPS tunnel** (`cloudflared` or `ngrok`; neither is installed on this machine).
   - Prefer a **stable hostname**: an ngrok static domain or a named Cloudflare tunnel.
   - Strict Mode makes Meta reject any redirect URI not registered exactly, so a new
     quick-tunnel hostname means updating the dashboard every time.

## Configure `apps/api/.env` (edit it yourself; never paste secrets into chat)

```
META_APP_ID=…                 # App settings › Basic
META_APP_SECRET=…
META_FACEBOOK_LOGIN_CONFIG_ID=…   # optional, Facebook Login for Business configuration
INSTAGRAM_APP_ID=…            # optional, Instagram › API setup with Instagram business login
INSTAGRAM_APP_SECRET=…
APP_URL=https://<tunnel-host>
CLIENT_ORIGIN=https://<tunnel-host>
API_PUBLIC_URL=https://<tunnel-host>
TRUST_PROXY=1
SERVE_WEB_DIST=../web/dist
COOKIE_SECURE=true            # cookies arrive over HTTPS through the tunnel
LOG_LEVEL=info                # request lines must be logged for the leak scan
```

Register in the Meta dashboard exactly the URLs that `npm run meta:verify` prints under
item 3. `GET /api/v1/integrations/meta` shows the same values.

## Start

```powershell
npm run build
# Capture the server log for item 13 (PowerShell):
npm start *>&1 | Tee-Object -FilePath api.log
# In another terminal:
cloudflared tunnel --url http://localhost:4000      # or your stable tunnel
npm run meta:verify -w @socialhub/api               # items 1–3 should now be PASS
```

Open **`https://<tunnel-host>`**, not `localhost`. The OAuth browser-binding cookie only
works when the web app and the callback share a host. Register a SocialHub user, which
makes you the owner, and create a workspace.

## Steps, in this order

| #    | You do                                                                                                                                                                                                                                                                                                                        | The verifier checks                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4    | **Social accounts → Connect Facebook.** Sign in as **user A** on Meta's screen, allow the permissions, and select all of A's Pages in Meta's dialog.                                                                                                                                                                          | A Facebook connection exists, and with `--live` Meta's `debug_token` says the token is valid **for your app id**                                      |
| 6, 7 | On **Choose accounts**, add **two or more** of A's Pages, plus the linked Instagram account.                                                                                                                                                                                                                                  | Pages are stored under A's connection; Meta still returns them                                                                                        |
| 5, 6 | **Connect Facebook** again, in the **same browser**. On Meta's screen, switch to **user B** ("Not you?" / log out of Facebook first). Add B's Page(s).                                                                                                                                                                        | Two distinct identities in one workspace, each with Pages                                                                                             |
| 8, 9 | Nothing extra.                                                                                                                                                                                                                                                                                                                | Every Page is linked to the identity Meta returns it for. Each Page's Meta tasks are shown, and only Pages with `CREATE_CONTENT` are publishing-ready |
| 10   | The Page-linked Instagram account appeared in step 6. _Optional:_ **Connect Instagram** with a professional account.                                                                                                                                                                                                          | An Instagram account is stored; with `--live`, Instagram `/me` works                                                                                  |
| 12   | **Disconnect user A's connection** (Social accounts → **Logins**, A's card ⋯ → Disconnect). Then **Sync now** on user B's card.                                                                                                                                                                                               | A's connection and Pages hold **no tokens**; B is still ACTIVE with tokens and active Pages                                                           |
| 11   | **Reconnect A** (**Reconnect** on A's login card). Then, as **user B on Facebook**, remove the app (Settings & privacy → Settings → Apps and websites / Business integrations). Click **Sync now** on B if the deauthorize callback isn't configured. _Optional:_ Reconnect B and **untick** `pages_manage_posts`, then Sync. | B becomes REVOKED with its Pages unusable, and the activity log shows it. An unticked publishing permission shows as missing publishing access        |
| 15   | (a) Copy the Meta URL from the address bar during **Connect Facebook** and complete it in a **different browser**: expect "same browser" error. (b) After a successful connect, press **Back** to the callback URL or reload it: expect "already completed". (c) **Cancel** on Meta's screen: expect "cancelled".             | OAuth states are stored only as digests and consumed after use                                                                                        |
| 14   | Create a **second workspace** and confirm none of the first workspace's logins or accounts appear there. Invite an **Editor**: they start with **no** accounts and must not see Connect, Sync or Remove. Grant them one Page (Social accounts → **Team access**, or in the invitation) and confirm they see only that Page.   | Every account and member access reference stays inside its own workspace                                                                              |
| 13   | In DevTools → Network, search the responses of `social-connections`, `discovery` and `social-accounts` for `EAA` / `IG`: expect nothing. Under Application → Local storage, expect only `sh-theme` / `sh-last-workspace`. Then **stop the server**.                                                                           | Every stored token is decrypted and searched for in the API views and **your `api.log`**, along with token-shaped strings and the app secrets         |

## Final check

```powershell
npm run meta:verify -w @socialhub/api -- --live --log api.log
```

- Phase 2 can be marked complete **only when items 4–15 are PASS** in this run.
- Send me the output; it contains no secrets.
- Any `FAIL` lists the evidence that contradicts the claim.

## Afterwards

- **Close the tunnel.** While it runs, anyone with the URL can reach your SocialHub
  instance, including registration.
- Remove or rotate test data as you prefer.
- The data-deletion callback can be checked from the Facebook side: remove the app and
  choose to delete its data, if Meta offers that option for your app type. Item 11
  covers revocation either way.

## What Meta restricts or blocks

| Area                                        | Status                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testing with accounts that have an app role | **Possible now** in Development mode with Standard Access. The requested permissions work for those people's own Pages.                             |
| Accounts without an app role                | **Blocked** until **App Review** (Advanced Access for each permission) and **Business Verification**, and the app is **Live**.                      |
| Natural 60-day token expiry                 | **Cannot be triggered on demand.** Revocation (step 11) exercises the same handling; expiry dates and OAuth 190/463 are covered by automated tests. |
| Facebook deauthorize callback               | Meta documents that it can be enabled but not its request format, so it is optional. Sync detects revocation regardless.                            |
| Instagram callbacks                         | Meta doesn't document which secret signs them; SocialHub accepts either app secret.                                                                 |
| Publishing                                  | **Not implemented** (Phase 4). Readiness only reflects permissions and the `CREATE_CONTENT` task.                                                   |
