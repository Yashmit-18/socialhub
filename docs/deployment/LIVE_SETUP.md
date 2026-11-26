# Live setup: website on Vercel, API on Render

Status (2026-11-26). This is the setup that is actually deployed. It differs from the plan in
[`DEPLOYMENT.md`](DEPLOYMENT.md), where Vercel also runs the API and Render only runs a worker.

| Part             | Address                                   | Runs                                                                                                   |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Website          | `https://socialhub-beta-blond.vercel.app` | Vercel project, Root Directory `apps/web`, config [`apps/web/vercel.json`](../../apps/web/vercel.json) |
| API + publisher  | `https://socialhub-nnzc.onrender.com`     | Render **web service**, `npm start`, publish worker inside the API                                     |
| Database         | MongoDB Atlas                             | the same database the PC used                                                                          |
| Publishing queue | Render **Key Value**                      | Redis for BullMQ                                                                                       |

The website calls the API directly on its own address (`VITE_API_URL`). This keeps the two on
different sites. **Known limit of this choice:** browsers that block third-party cookies cannot
keep people signed in. That means Safari, every iPhone browser, and private windows: people
are signed out on a page refresh and after 15 minutes. Connecting a Facebook Page also fails in
Safari and Firefox. Chrome and Edge work. The fix is to put the API under the website's own
address (a Vercel rewrite of `/api` to Render, or one custom domain for both).

## 1. Render web service

**Settings › Build & Deploy**

| Setting                                      | Value                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Build Command                                | `npm ci` (not `npm run build`: with `NODE_ENV=production`, npm skips `vite`, so building the website fails with `vite: not found`) |
| Start Command                                | `npm start`                                                                                                                        |
| Health Check Path (Settings › Health Checks) | `/api/v1/health`                                                                                                                   |

**Instance type:** Free instances sleep after 15 minutes without visits. The first visit
then takes about a minute, and scheduled posts go out only when the service wakes up. Use a
paid instance for reliable scheduling.

If the Build Command still runs `npm run build`, the variable `NPM_CONFIG_INCLUDE=dev` (in
`apps/api/.env.render`) makes npm install `vite` anyway, so that build also succeeds.

**Environment.** Paste [`apps/api/.env.render`](../../apps/api/.env.render) with **Add from
.env**, then **Save, rebuild, and deploy**. It is git-ignored and holds the real secrets copied
from `apps/api/.env`, so never commit or share it.

| Variable                                                                                     | Value                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`                                                                                   | `production`                                                      |
| `NPM_CONFIG_INCLUDE`, `MONGOMS_DISABLE_POSTINSTALL`                                          | `dev`, `1` (build tools are installed; no test database download) |
| `APP_URL`                                                                                    | `https://socialhub-beta-blond.vercel.app`                         |
| `CLIENT_ORIGIN`                                                                              | `https://socialhub-beta-blond.vercel.app` (only this one)         |
| `API_PUBLIC_URL`                                                                             | `https://socialhub-nnzc.onrender.com`                             |
| `COOKIE_SECURE`                                                                              | `true`                                                            |
| `COOKIE_SAMESITE`                                                                            | `none`                                                            |
| `TRUST_PROXY`                                                                                | `1`                                                               |
| `MONGODB_AUTO_INDEX`                                                                         | `true`                                                            |
| `META_GRAPH_API_VERSION`                                                                     | `v27.0`                                                           |
| `META_FACEBOOK_SCOPES`                                                                       | `pages_show_list,pages_read_engagement,pages_manage_posts`        |
| `META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID`                                                     | `1590814224104477`                                                |
| `PUBLISHING_MODE`                                                                            | `live`                                                            |
| `PUBLISHING_WORKER_INLINE`, `ANALYTICS_WORKER_INLINE`                                        | `true`                                                            |
| `ANALYTICS_MODE`                                                                             | `disabled`                                                        |
| `REDIS_URL`                                                                                  | the Key Value's **Internal** URL (section 2)                      |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`                                                        | `local`, `./storage-data` (or R2, section 5)                      |
| `MONGODB_URI`, `JWT_ACCESS_SECRET`, `TOKEN_ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET` | unchanged: the same values as `apps/api/.env` on the PC           |

Delete if present: `TUNNEL_PROVIDER`, `NGROK_DOMAIN`, `SERVE_WEB_DIST`. These are PC-only. If
`SERVE_WEB_DIST` stays, Render also serves a second copy of the website.

Variables set on the service itself override the same names in a linked Environment Group.

## 2. Render Key Value (publishing queue)

Render › **New** › **Key Value**:

- Region: the same region as the web service.
- Maxmemory Policy: `noeviction`. BullMQ needs it.
- Copy **Connect › Internal** URL (`redis://red-…:6379`) into the web service's `REDIS_URL`.

Without it, the API logs `REDIS_URL is not set` and publishing answers "queue unavailable".
A Free Key Value keeps no data over restarts. SocialHub's recovery sweep then re-queues
waiting posts from the database about 2 minutes after they are due, so they go out a little
late. A post that may already have been sent when the restart hit is marked "interrupted" for
a person to check, never sent twice automatically. A paid Key Value keeps its data.

## 3. Vercel project

| Setting                                          | Value                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings › Build and Deployment › Root Directory | `apps/web`                                                                                                                                                            |
| Environment Variables (Production)               | `VITE_API_URL=https://socialhub-nnzc.onrender.com/api/v1`, `VITE_COMPOSER_SERVER_DRAFTS=true`, `VITE_COMPOSER_SERVER_PRESETS=true`, `VITE_COMPOSER_MEDIA_UPLOAD=true` |

These values are read at build time, so redeploy after changing one. No server secrets belong
in Vercel: it only builds the website.

`apps/web/vercel.json` does three things:

- Every path that is not a file gets `index.html`, so refreshing `/w/...` works.
- It sends the API's security headers.
- It lets the page call `https://socialhub-nnzc.onrender.com` and Cloudflare R2.

If the Render address ever changes, update `connect-src` there.

## 4. Meta Developer Dashboard (app 1812162139994577)

Remove every old `trycloudflare.com` or `ngrok` address.

| Place                                                                  | Value                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| App settings › Basic › App Domains                                     | `socialhub-beta-blond.vercel.app`, `socialhub-nnzc.onrender.com`              |
| App settings › Basic › Privacy Policy URL                              | `https://socialhub-beta-blond.vercel.app/privacy.html`                        |
| App settings › Basic › Terms of Service URL                            | `https://socialhub-beta-blond.vercel.app/terms.html`                          |
| App settings › Basic › User data deletion › Data deletion callback URL | `https://socialhub-nnzc.onrender.com/api/v1/meta/facebook/data-deletion`      |
| App settings › Basic › Website › Site URL (if shown)                   | `https://socialhub-beta-blond.vercel.app/`                                    |
| Facebook Login › Settings › Valid OAuth Redirect URIs                  | `https://socialhub-nnzc.onrender.com/api/v1/oauth/facebook/callback`          |
| Facebook Login › Settings › Deauthorize callback URL (if shown)        | `https://socialhub-nnzc.onrender.com/api/v1/meta/facebook/deauthorize`        |
| Instagram Unified Login configuration 1590814224104477 › Redirect URL  | `https://socialhub-nnzc.onrender.com/api/v1/oauth/instagram-unified/callback` |

Keep these on: Client OAuth login, Web OAuth login, Enforce HTTPS, and Strict mode.

"URL blocked" from Facebook means the API sent a redirect URI that is not in the list above.
Check `API_PUBLIC_URL` on Render, and check that the latest Render deploy succeeded. A failed
deploy keeps the previous settings running.

## 5. Permanent image storage (Cloudflare R2), optional

Render's disk is wiped on every deploy and restart, so uploaded images disappear. To keep
them:

1. Cloudflare › R2 › create a bucket and turn on its public address. That address is
   `STORAGE_PUBLIC_BASE_URL`.
2. Create an API token with Object Read & Write for that bucket only.
3. Set the bucket's CORS policy:

   ```json
   [
     {
       "AllowedOrigins": ["https://socialhub-beta-blond.vercel.app"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": [],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. On Render, replace the two local storage variables with these:

   ```
   STORAGE_DRIVER=s3
   STORAGE_S3_BUCKET=<bucket name>
   STORAGE_S3_REGION=auto
   STORAGE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   STORAGE_S3_ACCESS_KEY_ID=<from the token>
   STORAGE_S3_SECRET_ACCESS_KEY=<from the token>
   STORAGE_PUBLIC_BASE_URL=<the bucket's public https address>
   ```

R2 has not been tested with SocialHub against a real bucket yet. To check the bucket, run
`npm run storage:verify -w @socialhub/api` as described in [`DEPLOYMENT.md`](DEPLOYMENT.md),
Step 7.

## 6. The PC

Keep the PC copy stopped: don't run `start-socialhub.cmd`. It uses the same database and
would publish too. `apps/api/.env` on the PC keeps its own tunnel addresses. The launcher
rewrites them, and they are not used by Render or Vercel.

## 7. Admin console

Full guide: [`docs/ADMIN_PANEL.md`](../ADMIN_PANEL.md). For this setup:

- **Ship both halves together.** The console pages come with the website (Vercel) and the
  data with the API (Render). One push to `main` updates both.
- **Indexes.** The new indexes are built by Render itself on the first deploy, because
  `MONGODB_AUTO_INDEX=true`.
- **Publisher before suspensions.** The publisher runs inside the Render API, so it has the
  new code as soon as that deploy is live. Don't suspend anyone before then.
- **Granting admin access** is done from the command line only. The PC's `apps/api/.env`
  points at the same Atlas database, so run this from the project folder on the PC:
  `npm run admin:grant -w @socialhub/api -- <email>`. The API itself does not need to be
  running.

## 8. Checks after a deploy

- `https://socialhub-nnzc.onrender.com/api/v1/health` returns `{"status":"ok","database":"connected"}`.
- `https://socialhub-nnzc.onrender.com/api/v1/oauth/facebook/callback?error=access_denied`
  redirects to `https://socialhub-beta-blond.vercel.app/oauth/meta/result?...`.
  If it redirects to an old tunnel address, the new settings are not live.
- `https://socialhub-beta-blond.vercel.app/w/test` loads the app (not a Vercel 404).
- In Chrome: sign in on the Vercel site, then Connect Facebook.
