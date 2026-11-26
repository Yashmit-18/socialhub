# Deploying SocialHub: Vercel (website + API) and Render (publishing worker)

> **The live deployment is different:** the website is on Vercel and the API runs as a Render
> web service. Its exact settings are in [`LIVE_SETUP.md`](LIVE_SETUP.md). This guide is the
> original plan.

Status (2026-11-26): **not deployed yet.** [`vercel.json`](../../vercel.json) and
[`render.yaml`](../../render.yaml) pass the providers' published schemas, and the API's Vercel
entry point ([`apps/api/index.js`](../../apps/api/index.js)) is tested locally, but nothing
here has run on a real Vercel or Render account yet. Vercel's multi-service projects are a
**Beta** feature. Tick the checks as you go.

After deployment SocialHub has a permanent public address (for example
`https://socialhub-synilogic.vercel.app`, or your own domain later), so no tunnel (ngrok,
cloudflared) is needed for it any more.

## Contents

1. [What runs where](#1-what-runs-where)
2. [Before you start](#2-before-you-start)
3. [Step 1: Choose the Vercel address](#step-1-choose-the-vercel-address)
4. [Step 2: MongoDB Atlas](#step-2-mongodb-atlas)
5. [Step 3: Media bucket (Cloudflare R2)](#step-3-media-bucket-cloudflare-r2)
6. [Step 4: Stop the copy on your PC](#step-4-stop-the-copy-on-your-pc)
7. [Step 5: Render (worker and Redis)](#step-5-render-worker-and-redis)
8. [Step 6: Vercel (website and API)](#step-6-vercel-website-and-api)
9. [Step 7: Bucket CORS and the storage check](#step-7-bucket-cors-and-the-storage-check)
10. [Step 8: Meta Developer Dashboard](#step-8-meta-developer-dashboard)
11. [Step 9: Check everything](#step-9-check-everything)
12. [Later: optional extras](#later-optional-extras)
13. [Troubleshooting](#troubleshooting)
14. [Environment variables](#environment-variables)

## 1. What runs where

| Part                             | Where                                                        | Notes                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Website (React app, legal pages) | Vercel service `web` (`apps/web`)                            | Static files. Every path that is not `/api/...` goes here; unknown paths get `index.html` so links like `/w/acme/compose` work after a refresh.        |
| API                              | Vercel service `api` (`apps/api`, entry `apps/api/index.js`) | Runs as a Vercel Function. Gets every `/api/...` request on the **same address** as the website (Facebook login needs that). Never runs the publisher. |
| Publisher (scheduled posts)      | Render **background worker** `socialhub-worker`              | Always on. Publishes queued and scheduled posts and re-checks stuck ones every 60 s (`apps/api/scripts/publish-worker.js`).                            |
| Publishing queue                 | Render **Key Value** `socialhub-redis`                       | Redis-compatible. The worker uses Render's private URL; the Vercel API uses the external URL (TLS + password).                                         |
| Database                         | MongoDB **Atlas** (already in use)                           | The same database the PC uses today: users, workspaces and Facebook connections carry over.                                                            |
| Uploaded images/videos           | **Cloudflare R2** (or AWS S3) bucket                         | Browsers upload straight to the bucket; Meta downloads post images from its public address.                                                            |

Why the worker is not on Vercel: Vercel runs code only while it answers a request. Scheduled
posts must go out at their time even when nobody has SocialHub open, and the publisher keeps a
Redis connection and a 60-second safety check running all the time. That needs an always-on
process, which is what the Render worker is.

**Costs.** Render background workers have no free plan, and free Key Value keeps no data, so
both Render parts are paid; see <https://render.com/pricing>. Check Vercel's plans at
<https://vercel.com/pricing>, including whether the free Hobby plan's terms allow commercial
use for your business. Cloudflare R2 has a free monthly allowance
(<https://developers.cloudflare.com/r2/pricing/>).

## 2. Before you start

- [ ] GitHub: everything is committed and pushed, including `vercel.json`, `render.yaml` and
      `apps/api/index.js` (both providers deploy what is on GitHub, not what is on the PC).
- [ ] Accounts: Vercel and Render (both connected to GitHub), Cloudflare, MongoDB Atlas, and
      access to the Meta Developer Dashboard.
- [ ] `apps/api/.env` open on the PC: several values are copied from it. **Never paste secret
      values into a chat, a screenshot or a file in Git.**

## Step 1: Choose the Vercel address

Both providers need the website's final address, so choose it first.

1. Pick a Vercel project name, for example `socialhub-synilogic`. The address will be
   `https://<project-name>.vercel.app`.
2. Open that address in a browser. If Vercel answers "404: NOT_FOUND / DEPLOYMENT_NOT_FOUND",
   the name is free. If a site loads, choose another name.
3. Write the address down. Below it is called `<URL>`.

## Step 2: MongoDB Atlas

1. Atlas › your project › **Network Access**. Vercel Functions connect from addresses that
   change, so the list must contain `0.0.0.0/0` ("allow access from anywhere"). Add it if
   it is missing. The database stays protected by its user name and password: make sure the
   database user has a long random password.
2. Note the cluster's region (Atlas › Clusters). `render.yaml` uses Render's `singapore`
   region; if the cluster is far from Singapore, change `region` for both services in
   `render.yaml` and push before Step 5 (it cannot be changed later). In Step 6 the Vercel
   function region is set close to the cluster too.

## Step 3: Media bucket (Cloudflare R2)

The bucket rules are in [`docs/COMPOSER_API_CONTRACT.md`](../COMPOSER_API_CONTRACT.md),
section "Setting up the bucket". For Cloudflare R2:

1. Cloudflare dashboard › **R2** › create a bucket, for example `socialhub-media`.
2. Turn on public access: the `r2.dev` public address (Cloudflare describes it as meant for
   development) or, better, a custom domain you own. That `https://` address is
   `STORAGE_PUBLIC_BASE_URL`.
3. R2 › **Manage API tokens** › a token with Object Read & Write for this bucket only. Keep the
   Access Key ID and the Secret Access Key (shown once).
4. Note the S3 endpoint: `https://<account-id>.r2.cloudflarestorage.com`.
5. Optional: a lifecycle rule deleting objects under `uploads/` after 1 day.

R2 makes the whole bucket public, so the short-lived unverified uploads under `uploads/` are
public too (random names, removed after verification). AWS S3 can keep them private (see the
contract doc). With AWS S3, also change `connect-src` in `vercel.json` (see Troubleshooting).

## Step 4: Stop the copy on your PC

The PC's API uses the same database and publishes real posts. Two running copies on one
database could both try to handle the same scheduled post.

1. Run `stop-socialhub.cmd` (or Ctrl+C in the API window).
2. From now on, do not start the PC copy against the Atlas database. For development on the PC,
   point `MONGODB_URI` at the local MongoDB (port 27018) or set `PUBLISHING_MODE=disabled`.

## Step 5: Render (worker and Redis)

1. Render Dashboard › **New** › **Blueprint** › the `socialhub` repository, branch `main`.
   Render reads [`render.yaml`](../../render.yaml) and shows `socialhub-worker` (background
   worker) and `socialhub-redis` (Key Value). Keep paid plans.
2. Fill in the values Render asks for:

   | Variable                                                   | Value                                                                               |
   | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
   | `APP_URL`, `CLIENT_ORIGIN`, `API_PUBLIC_URL`               | `<URL>` from Step 1 (all three the same)                                            |
   | `MONGODB_URI`, `JWT_ACCESS_SECRET`                         | copy from `apps/api/.env`                                                           |
   | `TOKEN_ENCRYPTION_KEY`                                     | copy **exactly** from `apps/api/.env` (the worker decrypts the Page tokens with it) |
   | `META_APP_ID`, `META_APP_SECRET`                           | copy from `apps/api/.env`                                                           |
   | `META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID`                   | copy from `apps/api/.env` if it has a value, else leave empty                       |
   | `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`                 | from Step 3                                                                         |
   | `STORAGE_S3_REGION`                                        | `auto` (Cloudflare R2)                                                              |
   | `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | from Step 3                                                                         |
   | `STORAGE_PUBLIC_BASE_URL`                                  | the bucket's public `https://` address from Step 3                                  |

3. Create the Blueprint. Render installs (`npm ci`), syncs the database indexes (pre-deploy)
   and starts `node apps/api/scripts/publish-worker.js`.
4. Open `socialhub-redis` › **Connect** › **External** and copy the external URL (it starts
   with `rediss://` and contains the password). It is the `REDIS_URL` for Vercel in Step 6;
   treat it like a password.

Check: `socialhub-worker` shows **Live** and its log shows no `Invalid environment
configuration` error.

## Step 6: Vercel (website and API)

1. Vercel › **Add New** › **Project** › import the `socialhub` GitHub repository. Use the
   project name from Step 1. Vercel reads [`vercel.json`](../../vercel.json): services `api`
   and `web`. Do not change the root directory or the build settings in the dialog.
2. Before deploying, add the **Environment Variables** (Production) listed in
   [Environment variables › Vercel](#vercel-production-environment). Copy secrets from
   `apps/api/.env`; `REDIS_URL` is the external URL from Step 5.
3. Deploy. Vercel installs at the repository root (`cd ../.. && npm ci`), builds the website,
   deletes the source maps, and bundles the API.
4. Project › **Settings** › **Functions** › **Function Region**: choose the region closest to
   the Atlas cluster (Mumbai `bom1` or Singapore `sin1`), then redeploy. Every API request talks
   to the database, so a far-away region makes everything slow.
5. Open `<URL>/api/v1/health`: it must show `"status":"ok"` and `"database":"connected"`.
6. Open `<URL>/w/test` and refresh: the app must load (the website's fallback to
   `index.html`), not a Vercel 404.

## Step 7: Bucket CORS and the storage check

1. In the R2 bucket's **CORS policy**, allow `PUT` from `<URL>` (exact origin, no trailing
   slash, never `*`):

   ```json
   [
     {
       "AllowedOrigins": ["https://socialhub-synilogic.vercel.app"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": [],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

2. Run the storage check from the PC. In a PowerShell window in the project folder, set the
   values for this window only (they override `apps/api/.env` for this run), then run it:

   ```powershell
   $env:STORAGE_DRIVER = 's3'
   $env:STORAGE_S3_BUCKET = '<bucket>'
   $env:STORAGE_S3_REGION = 'auto'
   $env:STORAGE_S3_ENDPOINT = 'https://<account-id>.r2.cloudflarestorage.com'
   $env:STORAGE_S3_ACCESS_KEY_ID = '<access key id>'
   $env:STORAGE_S3_SECRET_ACCESS_KEY = '<secret>'
   $env:STORAGE_PUBLIC_BASE_URL = '<public https address>'
   $env:CLIENT_ORIGIN = '<URL>'
   npm run storage:verify -w @socialhub/api
   ```

   Close the window afterwards. Every required line must say `PASS` (exit code 0). This check
   has never been run against a real bucket, so a `FAIL` is a real finding to fix first.

## Step 8: Meta Developer Dashboard

Replace the old tunnel address with `<URL>` everywhere:

| Dashboard place                                               | Value                                                |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| App settings › Basic › **App Domains**                        | the host only, e.g. `socialhub-synilogic.vercel.app` |
| App settings › Basic › **Privacy Policy URL**                 | `<URL>/privacy.html`                                 |
| App settings › Basic › **Terms of Service URL**               | `<URL>/terms.html`                                   |
| App settings › Basic › **User data deletion** (callback)      | `<URL>/api/v1/meta/facebook/data-deletion`           |
| Facebook Login › Settings › **Valid OAuth Redirect URIs**     | `<URL>/api/v1/oauth/facebook/callback`               |
| Facebook Login › **Deauthorize callback** (if shown)          | `<URL>/api/v1/meta/facebook/deauthorize`             |
| Unified Login configuration › **Redirect URL** (only if used) | `<URL>/api/v1/oauth/instagram-unified/callback`      |

The full list, including Instagram Login, is in
[`docs/META_SETUP_GUIDE.md`](../META_SETUP_GUIDE.md), section 3.

## Step 9: Check everything

- [ ] `<URL>` shows the landing page; `<URL>/privacy.html` loads.
- [ ] Sign in with your existing account (same database).
- [ ] Your Facebook Pages still show as connected (proves `TOKEN_ENCRYPTION_KEY` is the same).
- [ ] Composer: upload an image; it shows in the preview (CORS, `connect-src` and the public
      address work).
- [ ] Connect or reconnect a Page through Facebook login (redirect URI works).
- [ ] Publish one real test post you approve and check it on the Page (API → Redis → Render
      worker → Meta).
- [ ] Schedule one a few minutes ahead and leave SocialHub closed: it must go out by itself.

Images in old drafts were stored on the PC's disk (`STORAGE_DRIVER=local`) and are not in the
bucket; upload them again in the composer.

## Later: optional extras

| Extra                  | How                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Own domain             | Vercel › Project › **Domains**; then set the three URL variables on Vercel **and** Render to it, update the bucket CORS and Step 8 again |
| Email (password reset) | Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` on Vercel (the API sends the emails)                  |
| Daily Meta sync        | A Render Cron Job running `node apps/api/scripts/sync-meta-connections.js` daily, with the worker's environment variables                |
| Upload clean-up        | A Render Cron Job running `node apps/api/scripts/cleanup-media.js` hourly, or the bucket lifecycle rule from Step 3                      |
| Backups                | `npm run db:backup -w @socialhub/api` from the PC (README "Backups, key rotation and production safety"); Atlas has its own backups too  |
| Monitoring             | Set `HEALTH_DETAILS_TOKEN` (32+ characters) on Vercel for `GET /api/v1/health/details`                                                   |

## Troubleshooting

| Symptom                                                            | Likely cause and fix                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel install fails: `@socialhub/shared` not found (404 from npm) | The install ran inside the service folder. Both `installCommand`s in `vercel.json` must start with `cd ../..` (the monorepo root)                                               |
| Vercel build fails: `vite: not found`                              | The web install lost `--include=dev`                                                                                                                                            |
| Vercel cannot find the Express app                                 | The `api` service needs `"entrypoint": "index.js"` (the file `apps/api/index.js`)                                                                                               |
| A refreshed page such as `/w/acme/compose` shows Vercel's 404      | The `web` service's `rewrites` (fallback to `/index.html`) is missing                                                                                                           |
| API answers 503 "cannot reach its database"                        | Atlas Network Access lacks `0.0.0.0/0`, or `MONGODB_URI` was copied wrongly                                                                                                     |
| Log: `Invalid environment configuration` with a list of names      | Those variables are missing or malformed (production refuses `http://` addresses, `COOKIE_SECURE=false` and `simulated` modes)                                                  |
| Publishing says the queue is unavailable                           | `REDIS_URL` on Vercel must be the Key Value's **External** URL (`rediss://…`), not the internal one                                                                             |
| Posts stay queued / scheduled posts never go out                   | The Render worker is not running, or its `PUBLISHING_MODE`, `MONGODB_URI` or Redis differ from Vercel's                                                                         |
| Composer upload fails; browser console says "Refused to connect"   | The website's `connect-src` (in `vercel.json`, `web` › `headers`) allows `https://*.r2.cloudflarestorage.com` only. For another provider add its upload host there and redeploy |
| Composer upload fails with a CORS error                            | The bucket CORS (Step 7) does not list the exact `<URL>`                                                                                                                        |
| Meta cannot fetch the image when publishing                        | `STORAGE_PUBLIC_BASE_URL` is not publicly reachable over https                                                                                                                  |
| Composer has no Publish button or team drafts                      | `VITE_COMPOSER_*` variables missing on Vercel (read at build time: redeploy after adding them)                                                                                  |
| Pages show "reconnect needed"                                      | `TOKEN_ENCRYPTION_KEY` differs from the PC's value (on Vercel or on Render)                                                                                                     |
| Facebook: "URL blocked" / "redirect URI is not whitelisted"        | Step 8 values do not match `<URL>` exactly (https, no trailing slash)                                                                                                           |
| Facebook login fails on a preview deployment                       | Preview deployments have other addresses; use the production address                                                                                                            |
| Every request is slow                                              | The Vercel function region is far from the Atlas cluster (Step 6.4)                                                                                                             |

Undo a bad deploy: Vercel › Deployments › an earlier one › **Promote** (or Instant Rollback);
Render › worker › Events › **Rollback**.

Known differences from running on one server: the API's request rate limits are counted per
Vercel Function instance, so they are looser than on one server; the first request after a quiet
period also opens the database connection (about a second).

## Environment variables

### Vercel (Production environment)

| Variable                                                                                    | Value                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                  | `production`                                                              |
| `APP_URL`, `CLIENT_ORIGIN`, `API_PUBLIC_URL`                                                | `<URL>`                                                                   |
| `MONGODB_URI`, `JWT_ACCESS_SECRET`, `TOKEN_ENCRYPTION_KEY`                                  | from `apps/api/.env` (same as Render)                                     |
| `REDIS_URL`                                                                                 | Render Key Value **External** URL (`rediss://…`)                          |
| `PUBLISHING_MODE`                                                                           | `live`                                                                    |
| `PUBLISHING_WORKER_INLINE`, `ANALYTICS_WORKER_INLINE`                                       | `false` (the Render worker publishes)                                     |
| `ANALYTICS_MODE`                                                                            | `disabled`                                                                |
| `TRUST_PROXY`                                                                               | `1`                                                                       |
| `COOKIE_SECURE`                                                                             | `true`                                                                    |
| `META_APP_ID`, `META_APP_SECRET`                                                            | from `apps/api/.env`                                                      |
| `META_GRAPH_API_VERSION`                                                                    | `v27.0`                                                                   |
| `META_FACEBOOK_SCOPES`                                                                      | `pages_show_list,pages_read_engagement,pages_manage_posts`                |
| `META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID`                                                    | from `apps/api/.env`, only if it has a value                              |
| `STORAGE_DRIVER`                                                                            | `s3`                                                                      |
| `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ENDPOINT`                             | from Step 3 (`auto` region for R2)                                        |
| `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BASE_URL`       | from Step 3                                                               |
| `VITE_COMPOSER_SERVER_DRAFTS`, `VITE_COMPOSER_SERVER_PRESETS`, `VITE_COMPOSER_MEDIA_UPLOAD` | `true` (website build switches; `apps/web/.env.production` is not in Git) |

Do not set `SERVE_WEB_DIST`, `PORT`, `TUNNEL_PROVIDER` or `NGROK_DOMAIN` on Vercel.

### Render worker

Set by `render.yaml` or asked for when the Blueprint is created (Step 5): `NODE_ENV`,
`NODE_VERSION` (24.18.0), `REDIS_URL` (private link to the Key Value), `PUBLISHING_MODE`,
`ANALYTICS_MODE`, the three URL variables, `MONGODB_URI`, `JWT_ACCESS_SECRET`,
`TOKEN_ENCRYPTION_KEY`, the Meta and the storage variables. Values shared with Vercel must be
identical.

Settings the PC's `.env` has that are not listed (rate limits, token lifetimes, bcrypt rounds,
invitation and reset lifetimes) use the API's defaults unless you add them.
