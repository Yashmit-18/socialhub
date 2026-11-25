# Meta setup guide

This guide lists everything you must configure **by hand** in the Meta App Dashboard and
in `apps/api/.env` so SocialHub can connect Facebook Pages and Instagram professional
accounts. SocialHub's code already handles the OAuth flows, token exchange, encryption and
discovery. It cannot create or configure your Meta app for you.

> Every endpoint, permission and dashboard label below was checked against Meta's official
> documentation on **2026-11-20** (Graph API **v27.0**, released 2026-11-04). Meta changes
> its dashboard often. Items Meta does not document are marked **(not documented by Meta)**.
> The [verification notes](#verification-notes) list the sources.

---

## Contents

1. [What you are setting up](#1-what-you-are-setting-up)
2. [Before you start](#2-before-you-start)
3. [Choose your public HTTPS URL](#3-choose-your-public-https-url)
4. [Create the Meta app](#4-create-the-meta-app)
5. [App settings › Basic](#5-app-settings--basic)
6. [Facebook Login for Business](#6-facebook-login-for-business)
7. [Instagram API with Instagram Login](#7-instagram-api-with-instagram-login)
8. [App roles and Development mode](#8-app-roles-and-development-mode)
9. [Put the credentials in `apps/api/.env`](#9-put-the-credentials-in-appsapienv)
10. [Check the configuration](#10-check-the-configuration)
11. [Connect accounts end to end](#11-connect-accounts-end-to-end)
12. [Token lifetimes and keeping connections healthy](#12-token-lifetimes-and-keeping-connections-healthy)
13. [Going live: App Review and Business Verification](#13-going-live-app-review-and-business-verification)
14. [Troubleshooting](#14-troubleshooting)
15. [Checklist](#15-checklist)
16. [Verification notes](#verification-notes)

---

## 1. What you are setting up

SocialHub supports two official Meta login flows. Configure one or both.

| Flow                                   | Signs in with                              | Gives SocialHub                                                                                                   | Env variables                              |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Facebook Login for Business**        | A person's Facebook account                | Every Facebook Page the person can work on, plus the Instagram professional account linked to each of those Pages | `META_APP_ID`, `META_APP_SECRET`           |
| **Instagram API with Instagram Login** | An Instagram professional account directly | That one Instagram Business or Creator account. No Facebook Page is needed.                                       | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` |

**Which flow for which Instagram account?**

- **The account is linked to a Facebook Page you manage:** connect the Page's Facebook
  login. The Instagram account then shows up next to its Page.
- **The account has no Facebook Page:** use **Connect Instagram**. Meta documents that this
  flow "does not require a Facebook Page to be linked to the Instagram professional
  account".
- **Personal (non-professional) accounts:** Meta does not support them in either flow.
  Switch the account to Business or Creator in the Instagram app first.

Multiple identities are supported. Each Facebook login you connect becomes its own
connection in the workspace, and each connection provides its own Pages.

## 2. Before you start

You need:

- A Facebook account registered as a **Meta developer** (developers.facebook.com).
- At least one **Facebook Page** on which your Facebook account can create content, and/or
  an **Instagram Business or Creator account**.
- A **public HTTPS URL** that reaches the SocialHub API (see section 3).
- A **privacy policy URL** and a **terms of service URL**. Placeholders are fine while the
  app is in Development mode, but you need real ones to go Live.
- SocialHub running locally with a working MongoDB and `TOKEN_ENCRYPTION_KEY` set. Run
  `npm run secrets` to generate it. SocialHub encrypts every Meta token with this key.

## 3. Choose your public HTTPS URL

Meta redirects the browser back to SocialHub and calls SocialHub's callbacks. Meta's
Facebook Login security settings make **Strict Mode** mandatory, which means the redirect
URI must match exactly. They also offer **Enforce HTTPS**. Use an HTTPS URL. Meta does not
document whether `http://localhost` is accepted, so don't rely on it.

That URL goes into `API_PUBLIC_URL`. Every value you will paste into Meta comes from it:

| Paste into Meta                                                     | Value                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Facebook Login for Business › **Valid OAuth redirect URIs**         | `{API_PUBLIC_URL}/api/v1/oauth/facebook/callback`                   |
| Instagram › Business login settings › **OAuth redirect URIs**       | `{API_PUBLIC_URL}/api/v1/oauth/instagram/callback`                  |
| App settings › Basic › **User Data Deletion** (callback URL)        | `{API_PUBLIC_URL}/api/v1/meta/facebook/data-deletion`               |
| Instagram › Business login settings › **Deauthorize callback URL**  | `{API_PUBLIC_URL}/api/v1/meta/instagram/deauthorize`                |
| Instagram › Business login settings › **Data deletion request URL** | `{API_PUBLIC_URL}/api/v1/meta/instagram/data-deletion`              |
| Facebook deauthorize callback, _only if your dashboard shows one_   | `{API_PUBLIC_URL}/api/v1/meta/facebook/deauthorize`                 |
| App settings › Basic › **App Domains**                              | The host name of `API_PUBLIC_URL`, for example `social.example.com` |

Once the API is running, an admin can read the exact values from the app (section 10).
Copy them from there to avoid typos.

### The browser must use the same host as `API_PUBLIC_URL`

When you click **Connect**, SocialHub sets a short-lived, httpOnly "browser binding"
cookie. That cookie is how SocialHub knows the callback was finished in the same browser
that started it. The cookie belongs to the host the browser used to reach the API.

If the browser uses one host (say `localhost:5173`) and Meta redirects to another (a tunnel
URL), the cookie isn't sent. The connection then fails with "the connection must be
completed in the same browser where it was started". So **open SocialHub through the same
public URL you put in `API_PUBLIC_URL`**.

### Option A: a real domain (staging or production)

Set `APP_URL`, `CLIENT_ORIGIN` and `API_PUBLIC_URL` to your HTTPS origin, for example
`https://social.example.com`. Serve the web app from the API (`SERVE_WEB_DIST=../web/dist`).
Set `TRUST_PROXY` if the API runs behind a proxy.

### Option B: local testing through an HTTPS tunnel

1. Build the web app once: `npm run build`.
2. In `apps/api/.env`, set `SERVE_WEB_DIST=../web/dist`. The API then serves the dashboard
   and the API on one origin (port 4000).
3. Start an HTTPS tunnel to `http://localhost:4000` with a tool such as Cloudflare Tunnel
   or ngrok. Note the HTTPS URL it gives you.
4. In `apps/api/.env`, set these values, then start the API:

   ```dotenv
   APP_URL=https://YOUR-TUNNEL-HOST
   CLIENT_ORIGIN=https://YOUR-TUNNEL-HOST
   API_PUBLIC_URL=https://YOUR-TUNNEL-HOST
   TRUST_PROXY=1
   ```

   Start it with `npm run dev:api`.

5. Open `https://YOUR-TUNNEL-HOST` in the browser, **not** `localhost`.

> Many free tunnels give you a new host name each time they start. Each time that happens,
> update both the `.env` values and every URL you entered in Meta. A reserved or fixed
> tunnel host avoids this.
>
> The Vite dev server (`npm run dev:web`, port 5173) rejects requests for host names it
> does not know. This repository does not add tunnel hosts to it, so test OAuth through
> the API-served build in Option B.

## 4. Create the Meta app

1. Go to <https://developers.facebook.com/apps> and click **Create app**.
2. **Use case:** select **Other**. Meta's Instagram setup guide says: "Select the **Other**
   use case."
3. **App type:** choose **Business**. Meta requires this for both products SocialHub uses:
   - "Your app must be a business type app to be able to add the Instagram product."
   - "Your Meta app must be a business type app or an app with a use case that supports
     Facebook Login for Business."
4. Enter the app name and contact email. Connect a business portfolio if you have one.
   You'll need one later for Business Verification.
5. On the app's dashboard, add the products **Facebook Login for Business** (section 6)
   and **Instagram** (section 7). Add only the one you need if you use one flow.

> **Alternative:** Meta also offers a use case called **"Manage everything on your Page"**.
> Its required permissions are `business_management`, `pages_show_list` and
> `public_profile`, and it may add Facebook Login for Business automatically. Meta's docs
> don't say whether the Instagram product can be added to an app created that way, so this
> guide uses **Other → Business**, which Meta documents for both products.

## 5. App settings › Basic

Open **App settings › Basic** and fill in:

| Field                                                          | What to enter                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **App ID**                                                     | Read-only. Copy it to `META_APP_ID`.                                                                              |
| **App Secret**                                                 | Reveal it and copy it to `META_APP_SECRET`. Never commit it, paste it into chat, or put it in a `VITE_` variable. |
| **App Domains**                                                | The host name of `API_PUBLIC_URL`.                                                                                |
| **Privacy Policy URL**                                         | Your privacy policy. Meta requires it to explain how people can request deletion of their data.                   |
| **Terms of Service URL**                                       | Required to switch to Live mode.                                                                                  |
| **User Data Deletion**                                         | Choose the data deletion **callback URL** option and enter `{API_PUBLIC_URL}/api/v1/meta/facebook/data-deletion`. |
| **App Icon**, **Category**, **Contact Email**, **App Purpose** | Each is required to switch to Live mode.                                                                          |

Click **Save changes**.

**About the data deletion callback:** when a person asks Meta to delete their data, Meta
sends SocialHub a signed request. SocialHub verifies the signature with your App Secret,
deletes that person's connections and the Pages and accounts obtained through them, and
returns the `{ url, confirmation_code }` response Meta requires.

**Optional hardening:** **App settings › Advanced › Security › Require App Secret.**
SocialHub sends `appsecret_proof` on its Facebook Graph calls made with user or Page
tokens. If you turn this on and connections then fail, turn it back off and report it.

## 6. Facebook Login for Business

Skip this section if you only want Instagram Login.

### 6.1 Settings

Open **Facebook Login for Business › Settings**. In **Client OAuth settings**:

| Setting                           | Value                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Client OAuth login**            | On                                                                                                            |
| **Web OAuth login**               | On. SocialHub uses the web login dialog.                                                                      |
| **Enforce HTTPS**                 | On                                                                                                            |
| **Strict Mode** for redirect URIs | On. Meta: "Enabling Strict Mode is required for all apps."                                                    |
| **Valid OAuth redirect URIs**     | `{API_PUBLIC_URL}/api/v1/oauth/facebook/callback`, exactly as written (scheme, host, path, no trailing slash) |

Meta describes **Client OAuth login** as "the global on-off switch for using OAuth client
token flows". **Web OAuth login** enables flows that use the Facebook web login dialog,
which SocialHub uses. SocialHub never uses the JavaScript SDK.

Meta's manual-flow guide says "You can enable a deauthorize callback through the App
Dashboard". It does not say where, or what Meta sends **(not documented by Meta)**. If
your settings page has a **Deauthorize callback URL** field, enter
`{API_PUBLIC_URL}/api/v1/meta/facebook/deauthorize`.

If it doesn't, nothing breaks. SocialHub also detects removed access whenever Meta rejects
a token (on sync, discovery or reconnect), and marks the connection **Access revoked**.

Click **Save changes**.

### 6.2 Create a configuration (recommended)

Meta's Facebook Login for Business docs say that for user access tokens, "config_id has
replaced scope (although scope can still be included, we recommend that you do not use
it)". A configuration is a saved set of permissions and assets that the login dialog asks
for.

1. Open **Facebook Login for Business › Configurations** and create a configuration.
2. **Access token type:** **User access token**. SocialHub stores this token as the
   identity's connection and derives Page tokens from it. Don't choose "System-user access
   token"; SocialHub's flow doesn't use it.
3. **Assets:** select **Pages** and **Instagram accounts**.
4. **Permissions:** select the permissions in the table below.
5. Save, then copy the **Configuration ID** into `META_FACEBOOK_LOGIN_CONFIG_ID`.

When `META_FACEBOOK_LOGIN_CONFIG_ID` is set, SocialHub sends `config_id` and ignores
`META_FACEBOOK_SCOPES`. When it is empty, SocialHub sends `scope=` with
`META_FACEBOOK_SCOPES` instead. In that case, every listed permission must also be enabled
for the app, or Meta rejects the login.

### 6.3 Permissions

| Permission                  | Needed for                                                             | Meta's description / requirement                                                                                        |
| --------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pages_show_list`           | **Required.** Lists the Pages the person manages (`GET /me/accounts`). | "allows your app to access the list of Pages a person manages."                                                         |
| `pages_read_engagement`     | Page publishing (Phase 4) and Instagram publishing                     | A dependency of `pages_manage_posts`. Listed in Meta's Instagram content-publishing requirements.                       |
| `pages_manage_posts`        | Publishing to Pages (Phase 4)                                          | "allows your app to create, edit and delete your Page posts." Dependencies: `pages_read_engagement`, `pages_show_list`. |
| `instagram_basic`           | Reading the Instagram account linked to each Page                      | "allows your app to read an Instagram account profile's info and media."                                                |
| `instagram_content_publish` | Publishing to Page-linked Instagram accounts (Phase 4)                 | "allows your app to create organic feed photo and video posts on behalf of a business user."                            |

Situational extras:

- **`ads_management` and `ads_read`**: Meta's Instagram content-publishing page says: "If
  the app user was granted a role on the Page connected to your app user's Instagram
  professional account via the Business Manager, your app will also need: `ads_management`,
  `ads_read`". Add them only if that applies to you.
- **`business_management`**: required by the "Manage everything on your Page" use case.
  Meta describes it as "read and write with the Business Manager API". SocialHub does not
  call the Business Manager API, so leave it out unless that use case requires it. You
  would also have to justify it in App Review.
- **`pages_read_user_content`**: Meta's permissions reference lists it as a dependency of
  `instagram_basic`, but the Instagram "get started" guide asks only for `instagram_basic`
  and `pages_show_list`. Add it if the dashboard insists, or if Instagram accounts linked to
  Pages fail to appear.

Page roles also matter. Meta's Pages docs say the person must be able to perform the
`CREATE_CONTENT` task on a Page to publish to it. SocialHub shows Pages without that role
as **Missing publishing access**.

## 7. Instagram API with Instagram Login

Skip this section if you only want Facebook Login.

1. On the app dashboard, add the **Instagram** product. Meta describes it as "Allow
   creators and businesses to manage messages and comments, publish content, track
   insights, hashtags and mentions". Click **Set up**. Meta adds **API setup with Instagram
   login** automatically.
2. Open **Instagram › API setup with Instagram login**. In **3. Set up Instagram business
   login**, click **Set up**. Enter `{API_PUBLIC_URL}/api/v1/oauth/instagram/callback` as
   the **Redirect URL** and click **Save**.
3. Open **Business login settings** and fill in:

   | Field                         | Value                                                                |
   | ----------------------------- | -------------------------------------------------------------------- |
   | **Instagram App ID**          | Copy to `INSTAGRAM_APP_ID`. This is **not** the Meta App ID.         |
   | **Instagram app secret**      | Copy to `INSTAGRAM_APP_SECRET`. This is **not** the Meta App Secret. |
   | **OAuth redirect URIs**       | `{API_PUBLIC_URL}/api/v1/oauth/instagram/callback`                   |
   | **Deauthorize callback URL**  | `{API_PUBLIC_URL}/api/v1/meta/instagram/deauthorize`                 |
   | **Data deletion request URL** | `{API_PUBLIC_URL}/api/v1/meta/instagram/data-deletion`               |

4. You don't need to generate access tokens in the dashboard. SocialHub obtains them
   through the login flow.

Permissions SocialHub requests (`INSTAGRAM_SCOPES`):

| Permission                           | Needed for                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `instagram_business_basic`           | **Required.** Reads the account profile. Meta also requires it before a token can be refreshed. |
| `instagram_business_content_publish` | Publishing (Phase 4)                                                                            |

These are the current scope names. Meta replaced the old `business_basic`,
`business_content_publish`, … values and set their deprecation for January 27, 2025. Don't
use the old names.

## 8. App roles and Development mode

A new app is in **Development mode**. Meta's rule: "Apps in Development mode can only
request permissions from role users". In practice:

- Open **App roles › Roles** and add every Facebook account that will click **Connect
  Facebook** (yourself, teammates, test users) as an Administrator, Developer or Tester.
- Those people's own Pages and Instagram accounts can be connected without App Review.
- Anyone without a role on the app cannot authorize it until the app has Advanced Access
  and is Live (section 13).
- For **Instagram Login** in Development mode, the Instagram account must also be usable by
  a role user. Meta's docs don't give exact steps for this **(not documented by Meta)**. If
  Meta rejects an account, check **App roles › Roles** for an Instagram tester option and
  follow the prompts there.

## 9. Put the credentials in `apps/api/.env`

The values stay on the server only. `apps/api/.env` is git-ignored. The web app never sees
an App Secret or a token, and no `VITE_` variable is involved.

```dotenv
# Public HTTPS origin (section 3)
APP_URL=https://YOUR-HOST
CLIENT_ORIGIN=https://YOUR-HOST
API_PUBLIC_URL=https://YOUR-HOST
TRUST_PROXY=1                      # when behind a tunnel or proxy

# Facebook Login for Business (section 5 + 6)
META_APP_ID=                       # App settings › Basic › App ID
META_APP_SECRET=                   # App settings › Basic › App Secret
META_GRAPH_API_VERSION=v27.0
META_FACEBOOK_LOGIN_CONFIG_ID=     # Facebook Login for Business › Configurations
# Used only when META_FACEBOOK_LOGIN_CONFIG_ID is empty (this is the default list):
META_FACEBOOK_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish

# Instagram API with Instagram Login (section 7)
INSTAGRAM_APP_ID=                  # Instagram › Business login settings › Instagram App ID
INSTAGRAM_APP_SECRET=              # Instagram › Business login settings › Instagram app secret
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish
```

Rules SocialHub enforces when it starts:

- Set `META_APP_ID` and `META_APP_SECRET` together, or leave both empty. The same applies
  to `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`. Otherwise the API refuses to start and
  says why.
- App IDs must be numeric. `META_GRAPH_API_VERSION` must look like `v27.0`.
- Leaving a pair empty disables that flow, and its **Connect** button doesn't appear.

Every variable, with its default, is documented in
[`apps/api/.env.example`](../apps/api/.env.example). Restart the API after editing `.env`.

## 10. Check the configuration

Sign in to SocialHub as a workspace owner or admin and open **Social accounts**.

- **Connect Facebook** and **Connect Instagram** appear only for flows whose ID and secret
  are both set. If neither is set, the page says the Meta integration is not configured.

### The configuration validation endpoint

`GET /api/v1/integrations/meta` (any signed-in user) checks the server's Meta configuration
**without exposing any secret**. It reports whether each value is set and usable, never the
value itself. The response contains:

| Field                                                                 | Meaning                                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphApiVersion`, `publicApiUrl`, `appUrl`                           | The version and public URLs SocialHub is using                                                                                                      |
| `facebook.configured` / `instagram.configured`                        | Both the ID and the secret are set                                                                                                                  |
| `facebook.ready` / `instagram.ready`                                  | Configured **and** no blocking error below                                                                                                          |
| `…redirectUri`, `…deauthorizeCallbackUrl`, `…dataDeletionCallbackUrl` | The exact URLs to paste into Meta (sections 5 to 7)                                                                                                 |
| `facebook.usesLoginConfiguration`, `…scopes`                          | Whether a Login for Business configuration is used, or which scopes are sent                                                                        |
| `checks[]`                                                            | `{ id, level, provider, message }`. `error` means connecting will fail. `warning` means something Meta or publishing will need. `info` is advisory. |

Checks you may see:

| `id`                                                                        | Level                         | What to do                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `FACEBOOK_NOT_CONFIGURED`, `INSTAGRAM_NOT_CONFIGURED`                       | info                          | Set that flow's ID and secret if you want it (section 9).                                                   |
| `PUBLIC_URL_NOT_HTTPS`                                                      | warning (error in production) | Use an HTTPS `API_PUBLIC_URL` (section 3).                                                                  |
| `CALLBACK_HOST_MISMATCH`                                                    | error                         | The browser and the callback use different hosts, so every connection would fail. Use one host (section 3). |
| `CALLBACK_HOST_SPLIT`                                                       | warning                       | Split-site deployment. Only works if the web app calls the API at `API_PUBLIC_URL` directly.                |
| `LOGIN_CONFIG_RECOMMENDED`                                                  | info                          | Create a Facebook Login for Business configuration and set `META_FACEBOOK_LOGIN_CONFIG_ID` (section 6.2).   |
| `FACEBOOK_REQUIRED_SCOPE_MISSING`, `INSTAGRAM_REQUIRED_SCOPE_MISSING`       | error                         | Add the named permission to the scope variable.                                                             |
| `FACEBOOK_PUBLISHING_SCOPES_MISSING`, `INSTAGRAM_PUBLISHING_SCOPES_MISSING` | warning                       | Publishing (Phase 4) will need these permissions.                                                           |

These checks cover SocialHub's own configuration. They cannot confirm that the values
match your Meta app. The only real test is completing a connection (section 11): a wrong
App Secret, for example, shows up as "SocialHub could not complete the authorization with
Meta".

## 11. Connect accounts end to end

1. Open SocialHub **through `API_PUBLIC_URL`'s host** and go to **Social accounts**.
2. Click **Connect Facebook**. Meta's dialog opens. Sign in as a person who has a role on
   the app (section 8) and approve the request. If Meta asks which Pages and Instagram
   accounts to share, select the ones you want. SocialHub can only list what was shared.
3. Meta sends you back to SocialHub, which opens **Choose accounts to add**. It lists every
   Page this login can reach, each Page's linked Instagram account, and whether each one
   has publishing access. Select accounts and add them.
4. **Second Facebook identity:** log out of facebook.com in the same browser, or log in as
   the other person. Then click **Connect Facebook** again. That login becomes a separate
   connection. If a Page is already connected through a healthy login, SocialHub shows that
   and never takes it over.
5. **Instagram without a Page:** click **Connect Instagram** and sign in with the Instagram
   professional account.
6. On the **Logins** tab, each login card has **Sync now**, **Reconnect / update
   permissions**, **Disconnect** (keeps the accounts, erases tokens) and **Remove with its
   accounts**. **Sync all** checks every login and lists the result for each one. The
   **Facebook Pages** and **Instagram** tabs show every account with its status and
   publishing readiness.

Nothing is simulated. If Meta rejects a step, SocialHub shows the reason and doesn't mark
anything as connected.

## 12. Token lifetimes and keeping connections healthy

| Token                                            | Lifetime (per Meta)                                                                                                                                                             | What SocialHub does                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Facebook user token                              | Short-lived ("about one to two hours"), exchanged at once for a long-lived token that "generally lasts about 60 days"                                                           | Stores the long-lived token, encrypted. Tracks `expires_at` and `data_access_expires_at` from Meta's `debug_token`. |
| Facebook Page token (from long-lived user token) | "do not have an expiration date and only expire or are invalidated under certain conditions"                                                                                    | Stores one per Page, encrypted. Marks the Page unhealthy when Meta rejects it.                                      |
| Instagram Login token                            | Long-lived, 60 days. Refreshable once it is at least 24 hours old and still valid. "Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed." | Refreshes automatically during sync when the token is older than 24 hours and expires within 30 days.               |

Meta warns: "Do not depend on these lifetimes remaining the same". SocialHub always uses
the expiry dates Meta reports, not assumed durations.

**Schedule the sync.** There is no background worker yet (it arrives with BullMQ in
Phase 4). Run this once a day:

```bash
npm run meta:sync -w @socialhub/api
```

It re-validates every active connection, refreshes Instagram tokens when they are due,
updates permissions, and marks lost or revoked accounts. On Windows, use Task Scheduler. On
Linux, use cron. It exits non-zero if any connection failed to sync.

**Reconnecting.** When a token expires, access is revoked, or a permission was declined,
the connection shows **Reconnect**. Reconnecting must use the same Facebook or Instagram
account. A different account is rejected, and you can connect it as a new connection
instead. For Facebook, reconnect re-asks for declined permissions (`auth_type=rerequest`).
For Instagram, it forces a fresh sign-in (`force_reauth=true`).

## 13. Going live: App Review and Business Verification

Development mode is enough to test with your own accounts. To connect accounts of people
who have no role on your app:

1. **Business Verification.** Meta: "Business Verification is required to get Advanced
   Access." Start it from your business portfolio or the app dashboard.
2. **App Review.** "Permissions with Standard Access can only be requested from app users
   who have a role on the requesting app." Request **Advanced Access** for each permission
   you use (sections 6.3 and 7) through **App Review**. Meta asks for a screencast and a
   use-case description per permission. Request only what SocialHub actually uses.
3. **Live mode.** Meta: "Apps in Live mode can request permissions from anyone, but only
   permissions approved through App Review." Switch to Live only after App Review, with
   every Basic settings field from section 5 filled in.
4. **Graph API version.** SocialHub pins `META_GRAPH_API_VERSION`. Meta's changelog lists
   each version's expiry date. Move to a newer version before yours expires.

## 14. Troubleshooting

| Symptom                                                                 | Likely cause                                                                                        | Fix                                                                                                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connect Facebook / Connect Instagram** button missing                 | That flow's ID or secret is not set, or the API was not restarted                                   | Set both values (section 9) and restart the API.                                                                                                                      |
| Meta shows "URL blocked" or a redirect URI error                        | The redirect URI is not in the allow-list exactly (Strict Mode)                                     | Copy the URI from `GET /api/v1/integrations/meta` into **Valid OAuth redirect URIs** / **OAuth redirect URIs**. Check `https`, host and path, with no trailing slash. |
| Meta says a scope or permission is invalid                              | `META_FACEBOOK_SCOPES` or `INSTAGRAM_SCOPES` lists a permission the app doesn't have                | Add the permission to the app or configuration, or remove it from the env variable. Better: use `META_FACEBOOK_LOGIN_CONFIG_ID`.                                      |
| "…must be completed in the same browser where it was started"           | The browser's host differs from `API_PUBLIC_URL`, or cookies are blocked                            | Open SocialHub through `API_PUBLIC_URL` (section 3). Finish within 10 minutes (`META_OAUTH_STATE_TTL_MINUTES`).                                                       |
| "The authorization took too long and expired"                           | More than `META_OAUTH_STATE_TTL_MINUTES` (default 10) passed at Meta                                | Start again.                                                                                                                                                          |
| "Only Instagram Business and Creator accounts can be connected"         | A personal Instagram account was used                                                               | Switch it to a professional account in Instagram and try again.                                                                                                       |
| A Page is missing from **Choose accounts to add**                       | The Page wasn't selected in Meta's dialog, or the person has no task on it                          | **Reconnect and choose Pages again**, and select the Page in Meta's dialog. Make sure the person has a role on the Page.                                              |
| Page-linked Instagram account missing                                   | `instagram_basic` not granted, or the account isn't linked to the Page                              | Grant `instagram_basic` (section 6.3; also see `pages_read_user_content`). Link the account in the Page's settings, or use **Connect Instagram**.                     |
| Page shows **Missing publishing access**                                | `pages_manage_posts` / `pages_read_engagement` not granted, or no `CREATE_CONTENT` task on the Page | Reconnect and grant the permissions. Ask a Page admin for content access.                                                                                             |
| "You signed in with a different account than the one being reconnected" | Reconnect was done with another Facebook or Instagram account                                       | Reconnect with the original account, or use **Connect** to add the other one.                                                                                         |
| Only you can connect, teammates can't                                   | Development mode or Standard Access                                                                 | Give them a role on the app (section 8), or complete App Review (section 13).                                                                                         |

## 15. Checklist

- [ ] HTTPS URL chosen and `API_PUBLIC_URL`, `APP_URL`, `CLIENT_ORIGIN` set to it (section 3)
- [ ] Meta app created: use case **Other**, type **Business** (section 4)
- [ ] App settings › Basic: App Domains, Privacy Policy URL, Terms of Service URL, User Data Deletion callback, icon, category (section 5)
- [ ] App ID and App Secret copied to `META_APP_ID` and `META_APP_SECRET`
- [ ] Facebook Login for Business: settings, exact redirect URI, Strict Mode, Enforce HTTPS (section 6.1)
- [ ] Facebook Login for Business configuration (User access token, Pages + Instagram assets, permissions) and its ID in `META_FACEBOOK_LOGIN_CONFIG_ID` (section 6.2)
- [ ] Instagram product: business login set up, redirect URI, deauthorize and data deletion URLs (section 7)
- [ ] Instagram App ID and app secret copied to `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`
- [ ] Your account and teammates added under App roles (section 8)
- [ ] API restarted, configuration checked (section 10)
- [ ] Test connection completed in the browser (section 11)
- [ ] `npm run meta:sync -w @socialhub/api` scheduled daily (section 12)
- [ ] Later, for other people's accounts: Business Verification, App Review, Live mode (section 13)

---

## Verification notes

Checked against developers.facebook.com on 2026-11-20:

| Topic                                                               | Source                                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest Graph API version (v27.0, released 2026-11-04)               | `docs/graph-api/changelog`                                                                                                                                                   |
| Login dialog, code exchange, `auth_type=rerequest`                  | `docs/facebook-login/guides/advanced/manual-flow`, `docs/facebook-login/guides/permissions/request-revoke`                                                                   |
| Long-lived user and Page tokens                                     | `docs/facebook-login/guides/access-tokens/get-long-lived`, `docs/facebook-login/guides/access-tokens`                                                                        |
| `config_id`, configurations, business-type app                      | `docs/facebook-login/facebook-login-for-business`                                                                                                                            |
| `debug_token` fields, app access token                              | `docs/graph-api/reference/debug_token`                                                                                                                                       |
| `appsecret_proof`, Require App Secret                               | `docs/graph-api/securing-requests`                                                                                                                                           |
| `/me/accounts`, Page `tasks`, `CREATE_CONTENT`                      | `docs/graph-api/reference/user/accounts`, `docs/pages-api/overview`, `docs/pages-api/getting-started`, `docs/pages-api/posts`                                                |
| Page `instagram_business_account`, IG User fields                   | `docs/graph-api/reference/page`, `docs/instagram-platform/instagram-graph-api/reference/ig-user`                                                                             |
| Permissions and dependencies                                        | `docs/permissions`                                                                                                                                                           |
| Instagram via Facebook Login (permissions, Page link, `ads_*` note) | `docs/instagram-platform/instagram-api-with-facebook-login/get-started`, `docs/instagram-platform/content-publishing`                                                        |
| Instagram Login endpoints, `force_reauth`, `#_`, scopes, refresh    | `docs/instagram-platform/instagram-api-with-instagram-login/business-login`, `.../get-started`, `docs/instagram-platform/reference/access_token`, `.../refresh_access_token` |
| Instagram dashboard setup                                           | `docs/instagram-platform/instagram-api-with-instagram-login/create-a-meta-app-with-instagram`                                                                                |
| Use cases                                                           | `docs/development/create-an-app`                                                                                                                                             |
| Data deletion callback and `signed_request`                         | `docs/development/create-an-app/app-dashboard/data-deletion-callback`                                                                                                        |
| Basic settings fields, Live mode requirements                       | `documentation/development/create-an-app/app-dashboard/basic-settings`, `documentation/development/build-and-test/app-modes`                                                 |
| Standard vs Advanced Access, Business Verification                  | `docs/graph-api/overview/access-levels`                                                                                                                                      |
| Strict Mode, Enforce HTTPS, Client/Web OAuth login                  | `docs/facebook-login/security`                                                                                                                                               |
| Error codes and rate limits                                         | `docs/graph-api/guides/error-handling`, `docs/graph-api/overview/rate-limiting`                                                                                              |

**Not documented by Meta (as of 2026-11-20):**

- Where the Facebook **deauthorize callback** is configured and what it sends. SocialHub
  accepts the same `signed_request` format as the data deletion callback.
- Whether `http://localhost` is accepted as a redirect URI.
- Which secret signs Instagram Login's deauthorize and data deletion callbacks, and which
  user ID they carry.
- Exact steps for adding Instagram testers in Development mode.
- Which token Instagram publishing through Facebook Login needs. The content-publishing
  page says a Page token; the IG User reference says a User token. SocialHub keeps both
  (relevant in Phase 4).

Dashboard labels quoted here come from Meta's docs. If your dashboard looks different,
search Meta's docs for the label in quotes.
