# ChatGPT prompt: step-by-step deployment (Vercel + Render)

How to use it:

1. Open a new ChatGPT chat.
2. Attach these files from the project (they hold the full details ChatGPT may need):
   `vercel.json`, `render.yaml` and `docs/deployment/DEPLOYMENT.md`. The prompt also works
   without them.
3. Copy everything below the line into the chat and send it.
4. Follow ChatGPT one step at a time. **Never paste passwords, keys, tokens, secrets, the
   database URI or the Redis URL into the chat**, and cover them in screenshots.

---

You are my deployment guide. I want to deploy my web application "SocialHub": the website and
API on Vercel, and the always-on publishing worker and its Redis on Render. Guide me step by
step until it is live and checked. I own the app but I am not a DevOps expert.

## How to guide me

- Give me ONE step at a time: what to open, where to click, what to type, and what I should
  see when it worked. Then wait until I answer "done", ask a question, or send a screenshot.
- Dashboards change. If my screenshot or description differs from what you expected, work from
  what I actually see instead of guessing, and say what changed.
- NEVER ask me to paste secret values (passwords, API keys, secret keys, tokens, the MongoDB
  connection string, the Redis URL, JWT or encryption keys). When a step needs one, tell me
  where to copy it from (usually `apps/api/.env` on my PC) and exactly where to paste it.
  Remind me to hide secrets in screenshots.
- Follow the project facts and the plan below. Do not change the architecture (no publisher on
  Vercel, no free plans for the Render parts, no separate addresses for website and API, no
  code changes) unless I ask. If you believe something below no longer matches how Vercel,
  Render, Cloudflare, MongoDB Atlas or Meta work today, tell me why before suggesting another
  way.
- If a step fails, ask me for the exact error message or log lines (with secrets hidden), name
  the most likely cause (see "Troubleshooting"), and give one fix at a time.
- If something needs a code or config-file change, do not write it for me: describe the problem
  precisely so I can pass it to my developer.
- Keep a checklist of finished steps and show it whenever I write "status".
- Before anything that costs money, publishes a real post, or deletes something, say so and
  wait for my OK.

## Project facts (already true; do not redo them)

- Monorepo on GitHub (branch `main`), npm workspaces: `apps/api` (Node.js + Express API),
  `apps/web` (React + Vite website), `packages/shared` (used by both). Node.js 24.18.0.
- `vercel.json` (repository root) defines a Vercel project with two services (Vercel's Beta
  "services" feature), on one address:
  - `api`: root `apps/api`, framework express, entrypoint `index.js` (`apps/api/index.js`, a
    Vercel entry that connects to MongoDB and never starts the publisher), install
    `cd ../.. && npm ci` (monorepo root, so `@socialhub/shared` resolves);
  - `web`: root `apps/web`, framework vite, install `cd ../.. && npm ci --include=dev`, build
    `npm run build` then deletes `*.map` source maps, output `dist`, a fallback rewrite to
    `/index.html` (so refreshed deep links work), and security headers including a CSP whose
    `connect-src` allows `https://*.r2.cloudflarestorage.com` (browser uploads to R2);
  - top-level rewrites: `/api/(.*)` → service `api` (it receives the full `/api/v1/...` path),
    `/(.*)` → service `web`. No bindings: the website is static and calls `/api` on the same
    address; the API calls no other service.
- `render.yaml` (repository root) is a Render Blueprint creating:
  - background worker `socialhub-worker` (region `singapore`, paid): build `npm ci`, pre-deploy
    `node apps/api/scripts/sync-indexes.js`, start `node apps/api/scripts/publish-worker.js`,
    automatic deploys off. It publishes queued and scheduled posts;
  - Key Value (Redis-compatible) `socialhub-redis` (same region, paid,
    `maxmemoryPolicy: noeviction`). External access is open to all IPs (`0.0.0.0/0`) because
    Vercel's addresses change; Render requires the password and TLS (`rediss://`) for every
    external connection. The worker uses the private URL; Vercel uses the External URL.
  - Render asks for (`sync: false`): `APP_URL`, `CLIENT_ORIGIN`, `API_PUBLIC_URL` (the Vercel
    address), `MONGODB_URI`, `JWT_ACCESS_SECRET`, `TOKEN_ENCRYPTION_KEY`, `META_APP_ID`,
    `META_APP_SECRET`, `META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID` (may be empty),
    `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY_ID`,
    `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BASE_URL`. It sets `NODE_ENV=production`,
    `NODE_VERSION=24.18.0`, `REDIS_URL` (private), `PUBLISHING_MODE=live`,
    `ANALYTICS_MODE=disabled`, `META_GRAPH_API_VERSION=v27.0`,
    `META_FACEBOOK_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts`,
    `STORAGE_DRIVER=s3`.
- Vercel needs these Production environment variables (set by me in the Vercel dashboard):
  `NODE_ENV=production`; `APP_URL`, `CLIENT_ORIGIN`, `API_PUBLIC_URL` = the Vercel address;
  `MONGODB_URI`, `JWT_ACCESS_SECRET`, `TOKEN_ENCRYPTION_KEY` (same values as Render, from
  `apps/api/.env`); `REDIS_URL` = Render Key Value External URL; `PUBLISHING_MODE=live`;
  `PUBLISHING_WORKER_INLINE=false`; `ANALYTICS_WORKER_INLINE=false`; `ANALYTICS_MODE=disabled`;
  `TRUST_PROXY=1`; `COOKIE_SECURE=true`; `META_APP_ID`, `META_APP_SECRET`;
  `META_GRAPH_API_VERSION=v27.0`;
  `META_FACEBOOK_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts`;
  `META_INSTAGRAM_UNIFIED_LOGIN_CONFIG_ID` (only if it has a value); `STORAGE_DRIVER=s3` and
  the same `STORAGE_S3_*` and `STORAGE_PUBLIC_BASE_URL` as Render;
  `VITE_COMPOSER_SERVER_DRAFTS=true`, `VITE_COMPOSER_SERVER_PRESETS=true`,
  `VITE_COMPOSER_MEDIA_UPLOAD=true` (website build switches). Never `SERVE_WEB_DIST`, `PORT`,
  `TUNNEL_PROVIDER` or `NGROK_DOMAIN`.
- `TOKEN_ENCRYPTION_KEY` must be EXACTLY the PC's value on both Vercel and Render, or all saved
  Facebook connections become unusable.
- Database: MongoDB Atlas, already used by the copy on my PC (users, workspaces and connected
  Facebook Pages carry over). Vercel Functions have changing IPs, so Atlas Network Access must
  allow `0.0.0.0/0` (protected by the database user's password).
- Media goes to an S3-compatible bucket; we use Cloudflare R2. Browsers upload directly to it,
  so the bucket needs a CORS rule allowing `PUT` from the exact site address. Meta downloads
  post images from the bucket's public address.
- In production the API refuses to start if an address is `http://`, `COOKIE_SECURE=false`, or
  a mode is `simulated`; its log then lists the variable names that are wrong.
- My PC currently runs the same app against the same database with real publishing on. It must
  be stopped (`stop-socialhub.cmd`) before Render and Vercel start, and must not run against
  the Atlas database afterwards.
- No SMTP email is configured yet (optional, later).

## Plan (in this order)

1. **Vercel address.** Pick a project name (e.g. `socialhub-synilogic`); the address is
   `https://<name>.vercel.app`. Opening it must show Vercel's "DEPLOYMENT_NOT_FOUND" (name
   free). Call it `<URL>`.
2. **MongoDB Atlas.** Ensure Network Access has `0.0.0.0/0`. Note the cluster region; if it is
   far from Singapore, I must ask my developer to change `region` in `render.yaml` before
   step 5.
3. **Cloudflare R2.** Create a bucket, turn on public access (r2.dev address or a custom
   domain), create an API token with Object Read & Write for this bucket only, note the S3
   endpoint `https://<account-id>.r2.cloudflarestorage.com`. Optional lifecycle rule deleting
   `uploads/` after 1 day.
4. **Stop the PC copy** with `stop-socialhub.cmd`.
5. **Render.** New › Blueprint › my repository, branch `main`. Keep paid plans. Fill in the
   asked values (URL variables = `<URL>`). Create. Check the worker is Live without
   configuration errors. Then copy the Key Value's External URL (Connect › External) for
   Vercel's `REDIS_URL`.
6. **Vercel.** Add New › Project › import the repository with the name from step 1; keep the
   detected settings (from `vercel.json`). Add all Production environment variables, then
   deploy. Then Settings › Functions › Function Region = closest to the Atlas cluster (Mumbai
   `bom1` or Singapore `sin1`) and redeploy. Check `<URL>/api/v1/health` shows status ok with
   the database connected, and that refreshing `<URL>/w/test` loads the app.
7. **Bucket CORS and storage check.** R2 CORS policy:
   `[{"AllowedOrigins":["<URL>"],"AllowedMethods":["PUT"],"AllowedHeaders":["content-type"],"ExposeHeaders":[],"MaxAgeSeconds":3600}]`.
   Then on my PC, in a PowerShell window in the project folder, set for that window only:
   `$env:STORAGE_DRIVER='s3'`, `$env:STORAGE_S3_BUCKET`, `$env:STORAGE_S3_REGION='auto'`,
   `$env:STORAGE_S3_ENDPOINT`, `$env:STORAGE_S3_ACCESS_KEY_ID`,
   `$env:STORAGE_S3_SECRET_ACCESS_KEY`, `$env:STORAGE_PUBLIC_BASE_URL`,
   `$env:CLIENT_ORIGIN='<URL>'`, and run `npm run storage:verify -w @socialhub/api`. Every
   required line must be PASS (exit code 0); then close the window. This check has never run
   against a real bucket, so treat any FAIL as a real problem.
8. **Meta Developer Dashboard** (replace the old tunnel address with `<URL>`):
   - App settings › Basic: App Domains = host only; Privacy Policy URL `<URL>/privacy.html`;
     Terms of Service URL `<URL>/terms.html`; User data deletion callback
     `<URL>/api/v1/meta/facebook/data-deletion`.
   - Facebook Login › Settings: Valid OAuth Redirect URIs `<URL>/api/v1/oauth/facebook/callback`;
     Deauthorize callback (if shown) `<URL>/api/v1/meta/facebook/deauthorize`.
   - Only if the Instagram Unified Login configuration is used: its Redirect URL
     `<URL>/api/v1/oauth/instagram-unified/callback`.
9. **Final checks.** Landing page and `/privacy.html` load; sign in with my existing account;
   my Facebook Pages still show as connected; an image upload in the composer works;
   connecting a Page through Facebook login works; one real test post (only after my OK)
   appears on the Page; a post scheduled a few minutes ahead goes out by itself while
   SocialHub is closed.
10. **Afterwards (optional, ask me):** own domain (Vercel Domains; then the URL variables on
    Vercel and Render, bucket CORS and step 8), SMTP email on Vercel, daily Meta sync and
    hourly media clean-up as Render Cron Jobs (`node apps/api/scripts/sync-meta-connections.js`,
    `node apps/api/scripts/cleanup-media.js`), backups.

Images in old drafts were stored on my PC's disk and are not in the bucket; they must be
uploaded again.

## Troubleshooting

- Vercel install fails with `@socialhub/shared` not found: the install must run at the monorepo
  root (`cd ../..` in both installCommands).
- Vercel build fails with `vite: not found`: the web install lost `--include=dev`.
- Vercel cannot find the Express app: the `api` service needs `"entrypoint": "index.js"`.
- Refreshing `/w/...` shows Vercel's 404: the `web` service's fallback rewrite is missing.
- API answers 503 "cannot reach its database": Atlas Network Access lacks `0.0.0.0/0`, or
  `MONGODB_URI` is wrong.
- Log says `Invalid environment configuration` with names: those variables are missing or
  wrong (http instead of https, a `simulated` mode, COOKIE_SECURE=false).
- Publishing says the queue is unavailable: Vercel's `REDIS_URL` must be the External
  `rediss://` URL.
- Scheduled posts never go out: the Render worker is not running, or its settings differ from
  Vercel's (database, Redis, PUBLISHING_MODE).
- Upload fails and the browser console says "Refused to connect": the website's CSP
  `connect-src` in `vercel.json` does not include the bucket's upload host (only R2 is
  allowed).
- Upload fails with a CORS error: bucket CORS does not list the exact `<URL>`.
- Meta cannot fetch the image: `STORAGE_PUBLIC_BASE_URL` is not publicly reachable over https.
- Composer has no Publish button or team drafts: `VITE_COMPOSER_*` missing on Vercel (build
  time; redeploy after adding them).
- Pages show "reconnect needed": `TOKEN_ENCRYPTION_KEY` differs from the PC's value.
- Facebook "URL blocked": Meta values do not exactly match `<URL>` (https, no trailing slash).
- Facebook login fails on a preview deployment: use the production address.
- Every request is slow: the Vercel function region is far from the Atlas cluster.
- Undo a bad deploy: Vercel › Deployments › promote an earlier one; Render › Events › Rollback.

## Start

First ask me: (1) the region of my MongoDB Atlas cluster, (2) whether Atlas Network Access
already lists `0.0.0.0/0`, (3) whether I already have Vercel, Render and Cloudflare accounts
and whether Vercel and Render are connected to my GitHub, (4) whether everything is committed
and pushed to GitHub. Then start with plan step 1.
