# Meta App Review guide: public Facebook Page publishing

This guide prepares the App Review submission for the Meta app **Social Hub** (App ID
`1812162139994577`). The goal is that anyone can connect their own Facebook Pages to SocialHub
and publish to them without being added to the app as a Tester or Developer.

It was written on 2026-11-24 from the code in this repository, read-only checks of the real
Meta app, and Meta's current documentation (links in [Sources](#sources)). Nothing has been
submitted, no Meta Dashboard setting was changed, and no post has been published.

Related documents: [META_SETUP_GUIDE.md](META_SETUP_GUIDE.md) (dashboard setup, sections
5–8 and 13), README "Meta integration", [PUBLISHING_API.md](PUBLISHING_API.md), and the public
pages `/privacy.html`, `/terms.html` and `/data-deletion.html`.

## Contents

1. [Where things stand](#1-where-things-stand)
2. [What "Published" does and does not do](#2-what-published-does-and-does-not-do)
3. [Permission-to-feature mapping](#3-permission-to-feature-mapping)
4. [The pages_manage_posts API-call requirement](#4-the-pages_manage_posts-api-call-requirement)
5. [The publishing workflow reviewers see](#5-the-publishing-workflow-reviewers-see)
6. [Text for the submission form](#6-text-for-the-submission-form)
7. [Screen recording checklist](#7-screen-recording-checklist)
8. [Data handling](#8-data-handling)
9. [Public access requirements](#9-public-access-requirements)
10. [Hosting](#10-hosting)
11. [Known limitations](#11-known-limitations)
12. [Manual Meta Dashboard actions](#12-manual-meta-dashboard-actions)
13. [Sources](#sources)

## 1. Where things stand

| Item                                   | Status (2026-11-24)                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook Login (connect Pages)         | Works for the app's administrator. `npm run meta:verify -w @socialhub/api -- --live`: real login, token valid for this app, Page "Yashmit talks" has `CREATE_CONTENT`.                                                                                                                         |
| People without a role on the app       | **Blocked.** `GET /{app-id}/roles` lists exactly one role (the administrator). Other Facebook accounts are stopped on Facebook's own page ("App not available" / "Invalid request") and never reach SocialHub's callback (`npm run meta:oauth-attempts -w @socialhub/api` shows each attempt). |
| Real Page publishing                   | **Verified.** On 2026-11-24 the owner published three posts from the composer (two on "Yashmit talks", one on "Aerwvs"); each Meta post ID was stored and confirmed with a read-only `GET /{post-id}` (`is_published: true`).                                                                  |
| `pages_manage_posts` API call          | Three successful `POST /{page-id}/photos` calls made by SocialHub on 2026-11-24. Meta logs them within 2 days; check the App Review form.                                                                                                                                                      |
| Advanced Access, Business Verification | Not obtained. Both are needed for people without a role (section 9).                                                                                                                                                                                                                           |
| Public URL                             | Cloudflare Quick Tunnel. The address changes whenever a new tunnel starts (twice on 2026-11-24, after the PC slept). Each change needs the dashboard values updated (section 12).                                                                                                              |

## 2. What "Published" does and does not do

Meta: "Publishing means to make your app available to accounts that do not have a role on the
app itself." It does **not** grant any permission. People without a role can only grant
permissions the app has **Advanced Access** to. Meta: "Permissions with Standard Access … can
only be requested from app users who have a role on the requesting app", and Advanced Access
"must be approved on an individual permission and feature basis through the App Review
process". For Business apps (no app modes), "permissions must be approved for Advanced access
before they can be granted … by an app user without a role on the app".

**Why other accounts see "App not available":** none of the permissions SocialHub requests has
Advanced Access, so Meta has nothing it may ask a person without a role to grant. Meta's
documentation does not show that exact screen. Developer community reports match it to "This
app needs at least one supported permission" (not official).

Adding Testers does not provide public access. It only lets the people you add use the app.

## 3. Permission-to-feature mapping

From the code (`apps/api/src/integrations/meta/facebook.js` and
`apps/api/src/modules/publishing/adapters/facebookPage.js`). The login uses Facebook Login with
`scope=` (`META_FACEBOOK_SCOPES`). `public_profile` is always granted.

| Permission                                     | What the person does                                                                                      | Graph API calls                                                                                                                                                                                                                                      | Needed             | Safe to test                                                  | In this submission                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| `public_profile`                               | Connects Facebook; SocialHub shows which Facebook account the connection belongs to (Accounts › Logins).  | `GET /me?fields=id,name,picture`, `GET /me/permissions`, `GET /debug_token` (app token)                                                                                                                                                              | Yes                | Yes, read-only                                                | Yes                                                          |
| `pages_show_list`                              | Sees the Pages they manage and chooses which to add; SocialHub obtains each Page's access token.          | `GET /me/accounts?fields=id,name,category,tasks,access_token,picture,instagram_business_account{…}` (paginated)                                                                                                                                      | Yes                | Yes, read-only                                                | Yes                                                          |
| `pages_read_engagement`                        | Sees the Page's follower count; after publishing, gets the post's link. Required by `pages_manage_posts`. | `GET /{page-id}?fields=followers_count`, `GET /{post-id}?fields=permalink_url`, `GET /{video-id}?fields=status,permalink_url`                                                                                                                        | Yes                | Yes, read-only                                                | Yes                                                          |
| `pages_manage_posts`                           | Publishes a post to a Page they chose, after confirming it.                                               | One image: `POST /{page-id}/photos` (`url`, `caption`). Text: `POST /{page-id}/feed` (`message`). Several images: `POST /photos` with `published=false` each, then `POST /feed` with `attached_media`. Video: `POST /{page-id}/videos` (`file_url`). | Yes                | **No.** Every successful call creates content on a real Page. | Yes                                                          |
| `business_management`                          | Nothing. SocialHub does not request it and no code uses it.                                               | none                                                                                                                                                                                                                                                 | No                 | n/a                                                           | **Remove it.** Meta rejects permissions the app doesn't use. |
| `instagram_basic`, `instagram_content_publish` | Instagram accounts linked to Pages (discovery and publishing).                                            | `instagram_business_account` field on `/me/accounts`; Instagram publishing adapter                                                                                                                                                                   | Only for Instagram | n/a                                                           | No (see below)                                               |
| `read_insights`, `instagram_manage_insights`   | Nothing today: reading insights from Meta is off (`ANALYTICS_MODE`).                                      | only when `ANALYTICS_MODE=live`                                                                                                                                                                                                                      | No                 | n/a                                                           | No                                                           |

Meta's documented dependencies: `pages_manage_posts` needs `pages_read_engagement` and
`pages_show_list`. `pages_read_engagement` needs `pages_show_list`. `public_profile` is required
for Facebook Login for Business apps to authorize people without a role.

**Decision needed: Instagram scopes.** The login currently also asks for `instagram_basic` and
`instagram_content_publish` (the default `META_FACEBOOK_SCOPES`). Without Advanced Access,
people without a role cannot grant them. For a Facebook-only launch, either:

- add `META_FACEBOOK_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts` to
  `apps/api/.env` and restart the API, so the login asks only for what is being reviewed; or
- submit the Instagram permissions too, once Instagram publishing has been shown working with a
  real linked Instagram account (none is linked today).

**Gap: editing and deleting posts.** For `pages_manage_posts`, Meta's screencast requirement
says: "Demonstrate how your app user creates, edits, and deletes a post on their Facebook Page …
Showcase the newly updated post." SocialHub only **creates** posts. It cannot edit or delete a
published post. Either describe that clearly in the submission ("SocialHub only creates posts;
it does not edit or delete them") and accept the risk of a rejection, or build editing and
deleting first (`POST /{post-id}` with a new `message`, and `DELETE /{post-id}`). This is a
product decision; it is not implemented.

## 4. The pages_manage_posts API-call requirement

### What Meta counts

Meta: "Make at least 1 successful API call using each permission for which you are requesting
advanced access. Calls must be made within 30 days of submitting for App Review and can be made
using your app or the Graph API Explorer tool." The **Request advanced access** button "will
remain grayed out until a successful API has been logged … The API call data will be logged
within 2 days of your successful API call."

Meta does not list which endpoints count. A call that needs `pages_manage_posts` is the safe
choice: `POST /{page-id}/photos` or `POST /{page-id}/feed`. A read-only call (`GET /me/accounts`,
`GET /{page-id}/feed`) belongs to `pages_show_list` / `pages_read_engagement` and should not be
presented as a `pages_manage_posts` call. An unpublished upload (`published=false`) probably
counts, but Meta doesn't confirm it, and the screen recording needs a real post anyway.

### Recommended: one real post through SocialHub, recorded

The same post covers the API-call counter and the screen recording. **Status:** the API calls
were made on 2026-11-24 (three real posts, verified). The screen recording has not been made
yet. Record one more post this way, and keep the last call within 30 days of submitting.

1. In `apps/api/.env` set `PUBLISHING_MODE=live` and restart the API (server switch).
2. In SocialHub, the workspace owner opens **Settings › Publishing mode**, chooses **Switch on
   real publishing**, ticks the acknowledgement and enters their password (workspace switch).
3. Start the screen recording (section 7).
4. **Compose**: choose the Page, add an image, write the caption, click **Publish**. The dialog
   shows the image, the exact caption and the Page. Tick **I understand that this publishes a
   real post on these accounts**, then **Publish now**.
5. SocialHub sends exactly one request:

   ```text
   POST https://graph.facebook.com/v27.0/{page-id}/photos
   url             = signed link to the image on API_PUBLIC_URL (valid 2 hours)
   caption         = the caption shown in the dialog
   access_token    = the Page access token (encrypted at rest, never logged or shown)
   appsecret_proof = HMAC-SHA256 of the token with the app secret
   ```

   Meta answers `{"id": "<photo id>", "post_id": "<page id>_<post id>"}`. SocialHub stores
   `post_id` and shows **Published** only after this answer, with a **View post** link.

6. Open the post on Facebook to show it is live.
7. Afterwards, switch the workspace back to simulation if you want to.

The image must be JPEG, PNG, GIF, BMP or TIFF and at most 10 MB. Meta recommends under 1 MB for
PNG. Meta must be able to download it from the public URL, so the tunnel or host must be up.

### Alternative: Graph API Explorer

In the Graph API Explorer, select the app **Social Hub**, get a Page access token for the Page
with `pages_manage_posts`, and send `POST /{page-id}/photos` with `url` and `caption`. This also
creates a real public post, and it does not show SocialHub's own flow.

### Where to check the counter

Meta Developer Dashboard › **App Review** (the submission form). The `pages_manage_posts` row
should change from "0 of 1 API call(s) required" to complete, within 2 days of the call. Do the
call within 30 days before you submit.

## 5. The publishing workflow reviewers see

Each step names the screen and the code that does it.

| #   | Step                                                                                          | Where                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Create a SocialHub account (email and password) and a workspace.                              | `/register`, `/onboarding`                                                                   |
| 2   | **Accounts › Connect Facebook** opens Meta's login dialog; the person grants the permissions. | `metaOAuth.service.js`: single-use state (10 minutes), stored as a hash, tied to the browser |
| 3   | SocialHub lists the Pages the person manages and the person adds the ones they want.          | `GET /me/accounts`; **Add N accounts**                                                       |
| 4   | SocialHub stores each Page's access token, encrypted (AES-256-GCM).                           | `lib/crypto.js`, `models/encryptedSecret.js`                                                 |
| 5   | The owner turns on real publishing for the workspace (password required).                     | **Settings › Publishing mode**                                                               |
| 6   | **Compose**: choose the Page, upload an image, write a caption.                               | Composer; image stored by the API                                                            |
| 7   | **Publish** shows the image, the exact caption and the Page.                                  | Publish dialog                                                                               |
| 8   | The person ticks the real-post confirmation and clicks **Publish now**.                       | The API refuses a real post without it (`REAL_POST_CONFIRMATION_REQUIRED`)                   |
| 9   | The worker sends `POST /{page-id}/photos` with a signed image link Meta can download.         | `publishing.processor.js`, `adapters/facebookPage.js`                                        |
| 10  | Meta returns the post id; SocialHub stores it and shows **Published** with **View post**.     | Publishing screen, job details                                                               |

Errors (covered by automated tests against a simulated Meta):

| Situation                                            | What SocialHub does                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Expired or invalid token (code 190 / 463)            | Failed, **reconnect needed**; no retry                                           |
| Missing permission (code 200 / 10)                   | Failed, permission denied                                                        |
| Page or image rejected by Meta (code 100 and others) | Failed, rejected by the platform, with Meta's message (tokens removed)           |
| Image wrong type or too large                        | Refused before anything is sent                                                  |
| Media not reachable over public HTTPS                | Refused before anything is sent                                                  |
| Rate limit / Meta outage                             | Retried later                                                                    |
| No answer from Meta (timeout, connection lost)       | **Outcome unknown**: never retried automatically; a person checks the Page first |
| Double click or repeated request                     | One post: one idempotency key per click                                          |
| Meta answers without a post id                       | Not marked published (outcome unknown)                                           |

## 6. Text for the submission form

Write these in English. Replace `<PUBLIC_URL>` with the address reviewers will use.

### App purpose (short)

> SocialHub is a team workspace for managing Facebook Pages. A Page admin connects their
> Facebook account, chooses which of their Pages to add, prepares a post with an image and a
> caption, previews exactly what will be posted and, after explicitly confirming, publishes it
> to the Page they selected.

### pages_show_list

> **How we use it:** After the person connects Facebook, SocialHub calls `GET /me/accounts` to
> show the Facebook Pages they manage, so they can choose which Pages to add to their SocialHub
> workspace. Only Pages the person adds are stored. We also use it to obtain the Page access
> token needed to publish to a Page the person chose.
>
> **Benefit:** The person sees and picks their own Pages instead of typing Page IDs, and
> SocialHub never acts on a Page they did not choose.

### pages_read_engagement

> **How we use it:** SocialHub reads each added Page's follower count
> (`GET /{page-id}?fields=followers_count`) to show it on the account list, and after publishing
> it reads the new post's link (`GET /{post-id}?fields=permalink_url`) so the person can open the
> post on Facebook. It is also required by `pages_manage_posts`.
>
> **Benefit:** The person confirms they connected the right Page and can open each published
> post directly from SocialHub.

### pages_manage_posts

> **How we use it:** When the person publishes a post they prepared in SocialHub, SocialHub
> sends it to the Page they selected: one image with its caption via
> `POST /{page-id}/photos`, or a text post via `POST /{page-id}/feed`. Before anything is sent,
> SocialHub shows the image, the exact caption and the destination Page, and the person must
> tick "I understand that this publishes a real post on these accounts". SocialHub publishes
> only when the person clicks Publish; it never posts automatically, and it shows a post as
> published only after Facebook returns the post ID. SocialHub does not edit or delete posts.
>
> **Benefit:** Page admins prepare and publish posts to the Pages they manage from one place,
> with a preview and an explicit confirmation before each real post.

### public_profile

> **How we use it:** SocialHub reads the connected Facebook account's ID, name and profile
> picture (`GET /me`) to show which Facebook account a Page connection belongs to, and to keep
> connections from different people apart. It is not used to sign in to SocialHub.

### Reviewer instructions

> 1. Open `<PUBLIC_URL>/register` and create a SocialHub account with any email address and a
>    password, then create a workspace. You are its owner.
> 2. Open **Accounts** and click **Connect Facebook**. Log in with your Facebook test account
>    that manages a Facebook Page and grant the requested permissions.
> 3. Back in SocialHub, select your Page and click **Add 1 account**. It appears under
>    **Facebook Pages**.
> 4. Open **Settings › Publishing mode**, click **Switch on real publishing**, tick the
>    acknowledgement and enter your SocialHub password.
> 5. Open **Compose**, select the Page, add an image (JPEG or PNG, up to 10 MB) and a caption,
>    then click **Publish**. Check the preview, tick the confirmation and click **Publish now**.
> 6. Open **Publishing**. When the post shows **Published**, click **View post** to open it on
>    Facebook.
>
> SocialHub only creates posts. It does not edit or delete them.

Before submitting, check that the server runs with `PUBLISHING_MODE=live` and that
`<PUBLIC_URL>` stays reachable for the whole review.

## 7. Screen recording checklist

Meta: "1080 or better", English UI, captions and tool-tips, no audio; show "an app user
granting your app each permission" and "how your app uses each granted permission"; "Capture
the entire login flow, from logged-out to logged-in."

- [ ] Start logged out of SocialHub and of Facebook.
- [ ] Register or log in to SocialHub; show the workspace.
- [ ] **Connect Facebook**: show Meta's dialog, the Page selection and every permission being
      granted (`public_profile`, `pages_show_list`, `pages_read_engagement`,
      `pages_manage_posts`).
- [ ] `pages_show_list`: show the list of Pages and adding one.
- [ ] `pages_read_engagement`: show the Page with its follower count, and later the post link.
- [ ] Turn on real publishing in **Settings › Publishing mode**.
- [ ] `pages_manage_posts`: compose with an image and caption, show the preview and the
      real-post confirmation, click **Publish now**, wait for **Published**.
- [ ] Click **View post** and show the post on the Facebook Page.
- [ ] Add a caption at each step saying which permission is being used.
- [ ] Optional: show **Disconnect** and the data-deletion page.

Do not record secrets: no `.env`, no tokens, no developer tools showing requests.

## 8. Data handling

Facts from the code. The public pages (`/privacy.html`, `/data-deletion.html`) describe the same
things.

| Data                                     | Stored                                                                           | Protection / retention                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SocialHub account                        | name, email, bcrypt password hash                                                | until the account is deleted (by email request; no self-service yet)                                           |
| Sign-in sessions                         | hashed session tokens, IP address, user agent                                    | deleted when they expire                                                                                       |
| Facebook connection                      | Facebook user ID, name, picture, granted/declined permissions, user access token | token AES-256-GCM encrypted at rest, never sent to the browser or logged                                       |
| Pages                                    | Page ID, name, category, picture, tasks, follower count, Page access token       | token encrypted the same way                                                                                   |
| OAuth security codes                     | SHA-256 hashes only                                                              | single use, expire after 10 minutes, removed about an hour later                                               |
| Media files                              | the uploaded files (local disk on the server, `STORAGE_DRIVER=local`)            | served only through signed links that expire (6 h in SocialHub, 2 h for Meta); files are not encrypted on disk |
| Drafts, publishing history, activity log | captions, account names, Meta post IDs and links                                 | until deleted in the app or the workspace is deleted                                                           |
| Meta deletion requests                   | confirmation code, date, counts, one-way hash of the Meta user ID                | kept so the status link works                                                                                  |

**Disconnect** erases tokens and keeps names. **Remove with its accounts**, Meta's data-deletion
callback and deleting a workspace delete connections, Pages, their tokens, insights and check
history. Activity log entries and publishing history that mention a Page by name are kept until
the workspace is deleted. The deletion status link says exactly this.

**Deauthorize / data deletion callbacks:** `POST /api/v1/meta/facebook/deauthorize` and
`POST /api/v1/meta/facebook/data-deletion`. Both are accepted only with a valid `signed_request`
signed with the app secret; anything else gets HTTP 400.

**Service providers (data processors):** MongoDB Atlas (database), Cloudflare (carries all
traffic to SocialHub; HTTPS ends at Cloudflare's edge), and Meta. Email delivery is not
configured. Media and the Redis queue are on the SocialHub server itself.

**Only you can answer** (Meta's Data Handling questions): the responsible entity's legal name and
country, the countries where each processor stores data (check the Atlas cluster region),
whether any public authority requested data in the last 12 months, and your policy for such
requests. The privacy policy names the operator "SocialHub" with contact
`workwithyashmit@gmail.com`. If Business Verification uses a different legal name, update
`LEGAL_CONTACT` in `apps/web/src/pages/legal/legalContent.js` to match.

## 9. Public access requirements

| Requirement                                                                                         | Status                                                                                                              | Who                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| App published ("Go live")                                                                           | Marked Published (per the dashboard)                                                                                | done, but grants no permission by itself |
| Advanced Access: `public_profile`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | Not approved                                                                                                        | you: App Review                          |
| Successful API call per permission (30 days)                                                        | `pages_manage_posts` 0 of 1; read permissions: made by the real connection, check the form                          | you approve the real post (section 4)    |
| Business Verification                                                                               | Not done                                                                                                            | you: in Meta Business Manager            |
| Tech Provider / Access Verification                                                                 | Access Verification retired on 2026-10-09; Business Verification is still required to access other businesses' data | nothing extra                            |
| Privacy Policy, Terms, data deletion pages                                                          | Built and public at the current address                                                                             | update the dashboard URLs                |
| App Domains, OAuth redirect, callbacks                                                              | Dashboard lists an old tunnel address                                                                               | you: update (section 12)                 |
| Category, 1024×1024 icon, App Purpose, Primary Contact                                              | Category empty; icon is Meta's default                                                                              | you                                      |
| Stable public URL for reviewers                                                                     | Quick Tunnel (changes; went down on 2026-11-24)                                                                     | you: section 10                          |

Meta: "Apps that request advanced access for permissions … must be connected to a Business that
has completed Business Verification." It is done in Business Manager with the legal business
name, address, phone, website and official documents. Whether an individual without a
registered business can complete it is not documented.

Typical review time: Meta says "within a week" in the submission guide and "may take several
weeks" in its FAQ. "If we are unable to access your app to test it, your entire submission will
be rejected."

## 10. Hosting

SocialHub currently runs on this PC behind a **Cloudflare Quick Tunnel**
(`start-socialhub.cmd`). That is fine for your own testing but not for App Review:

- The address is random and changes whenever a new tunnel starts. On 2026-11-24 the address
  `deleted-strikes-audience-saints` stopped resolving (most likely after the PC slept); the
  launcher replaced it with a new one. Every change breaks the dashboard URLs, the OAuth
  redirect and any link given to reviewers.
- Reviewers test over days or weeks, so the PC would have to stay on and awake throughout.
- Changing settings after submitting "may require re-review".

Options (nothing has been bought or deployed):

| Option                                                                                      | Needs                                                                                                                                             | Notes                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Cloudflare **named** tunnel on your own domain                                              | a domain added to Cloudflare (yearly registration fee), `cloudflared tunnel login`                                                                | stable hostname; tunnel itself is free; the PC must stay on                                                      |
| Cloud hosting for the API (for example a small VPS or a Node hosting service) plus a domain | Node.js 20.19 or newer, MongoDB Atlas (already used), Redis, persistent media storage Meta can download from (S3-compatible, `STORAGE_DRIVER=s3`) | does not depend on the PC; the S3 driver has never been checked against a real bucket (`npm run storage:verify`) |

Free tiers that sleep when idle are a poor fit: a reviewer's first request can time out.

## 11. Known limitations

- **No edit or delete of published posts** (see section 3). Meta's screencast text for
  `pages_manage_posts` mentions both.
- **No "Continue with Facebook" sign-in.** People sign in to SocialHub with email and password
  and connect Facebook afterwards. Facebook Login is used only to connect Pages.
- **Real publishing never ran against Meta.** The adapters and error handling are tested against
  a simulated Meta only. The first real post is also the first end-to-end check.
- **Instagram is not ready:** no Instagram account is linked to the test Page; Instagram needs
  JPEG images within 4:5 to 1.91:1.
- **The SocialHub account itself has no self-service deletion;** people email the contact
  address.
- **The new workspace default is simulation.** Each workspace owner (including reviewers) must
  switch on real publishing with their password.

## 12. Manual Meta Dashboard actions

Do these yourself; nothing here was changed automatically. Use the current public address
(`node scripts/socialhub-launcher.js status` prints it; on 2026-11-24 it was
`https://requests-immunology-relationship-store.trycloudflare.com`, and it will change).

1. **App settings › Basic:** App Domains (host only), Privacy Policy URL `<PUBLIC_URL>/privacy.html`,
   Terms of Service URL `<PUBLIC_URL>/terms.html`, User data deletion: callback
   `<PUBLIC_URL>/api/v1/meta/facebook/data-deletion`, Category, a 1024×1024 icon, App Purpose,
   Primary Contact.
2. **Facebook Login settings:** Valid OAuth Redirect URI
   `<PUBLIC_URL>/api/v1/oauth/facebook/callback`; Deauthorize callback
   `<PUBLIC_URL>/api/v1/meta/facebook/deauthorize`.
3. **App Review submission:** keep `public_profile`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`; **remove `business_management`**; decide on the Instagram scopes
   (section 3).
4. **Business Verification** in Meta Business Manager, connected to this app.
5. Make the `pages_manage_posts` call (section 4) and wait for the counter.
6. Fill **Allowed Usage**, **Data Handling** (section 8) and **Reviewer Instructions**
   (section 6); upload the screen recording (section 7).
7. Before submitting: stable URL (section 10), `PUBLISHING_MODE=live` on the server.

## Sources

Read on 2026-11-24.

- App Review submission guide:
  <https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide>
- App Review overview:
  <https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review>
- Access levels: <https://developers.facebook.com/documentation/development/graph-api/overview/access-levels>
- Publishing an app: <https://developers.facebook.com/documentation/development/release>
- App modes: <https://developers.facebook.com/documentation/development/build-and-test/app-modes>
- Business Verification:
  <https://developers.facebook.com/documentation/development/release/business-verification>
- Retiring Access Verification (2026-10-09):
  <https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps/>
- Permissions reference: <https://developers.facebook.com/documentation/development/permissions>
- Facebook Login for Business:
  <https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business>
- Pages API overview and posts: <https://developers.facebook.com/documentation/pages-api/overview>,
  <https://developers.facebook.com/documentation/pages-api/posts>
- Page photos reference: <https://developers.facebook.com/docs/graph-api/reference/page/photos/>
- Data handling questions:
  <https://developers.facebook.com/docs/development/release/data-handling-questions/questions-preview>
- Screen recordings: <https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/>
