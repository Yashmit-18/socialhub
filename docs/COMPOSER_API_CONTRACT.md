# Composer API contract

This document specifies the backend endpoints that the **Universal Post Composer** frontend
(`apps/web/src/features/composer/`, route `/w/:slug/compose`) is built against.

> **Status (2026-11-21)**
>
> - **§4 drafts, §5 media upload and §6 account presets are implemented** in `apps/api` and
>   tested end to end. The composer uses them when its capability flags are on (§2).
> - **§7 was not built as proposed.** Publishing is the separate publishing API
>   ([PUBLISHING_API.md](PUBLISHING_API.md), `POST /publish-jobs`). Since 2026-11-21 the
>   composer's Publish button uses it when team drafts are on; the server decides whether
>   posts are only simulated (real publishing is not enabled). `submitPost` was removed.
> - **Draft visibility (2026-11-21):** a draft is returned only to members who may use every
>   account it targets (owners and admins always). See "Drafts (§4)" in §11.
> - Media upload needs a storage driver configured on the API (§5.4). Only the local-disk
>   driver has been run for real. The S3 driver is tested against a simulated provider and
>   Amazon's documented signing example, not against a live bucket.
> - "Implementation notes" (§11) lists every place where the implementation differs from, or
>   adds detail to, the original proposal.

Frontend files that implement this contract:

| File                                                | Role                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `services/composerApi.js`                           | One function per endpoint below; each checks its capability flag first |
| `services/capabilities.js`                          | Capability flags and the "not available yet" messages                  |
| `model/serialize.js`                                | Composer state ⇄ `ContentPackageInput` / `ContentPackage`              |
| `model/text.js`                                     | Caption composition algorithm (§7.3), which the backend must mirror    |
| `model/validation.js`, `constants/platformRules.js` | Client-side platform checks (§8), which the backend must also enforce  |

---

## 1. Conventions

These follow the existing API (see README → API reference):

- **Paths.** Everything is under `/api/v1`, with bearer auth, and the client sends
  `X-SocialHub-Client: web`.
- **Errors** use the standard envelope: `{ error: { code, message, requestId, details? } }`.
  - Validation failures return `422 VALIDATION_ERROR` with `details.fields` (`{ "caption": "…" }`).
    The composer shows `message`, and maps `fields` where it can.
  - Non-members get `404` on workspace routes, never `403`.
- **Strict bodies.** Unknown keys are rejected, as with the existing Zod `strictObject`
  schemas. Request schemas belong in `packages/shared/src/schemas.js`, which the backend owns.
- **Tenancy.** Every document is workspace-scoped.
- **Account access is enforced in one place.** Every `targetAccountIds` /
  `socialAccountIds` value must pass `accessibleAccountFilter(membership)` in
  `modules/socialAccounts/socialAccount.service.js`. An id that is not accessible to the
  caller is a `422` with a field error. It is never silently dropped on write.
- **Permissions** come from the existing `PERMISSIONS` in `packages/shared/src/roles.js`:

| Action                                                                              | Permission        |
| ----------------------------------------------------------------------------------- | ----------------- |
| Open the composer, create/update/delete drafts, upload media, create/delete presets | `content:create`  |
| List/read drafts and presets                                                        | `content:read`    |
| Submit a post for publishing (§7)                                                   | `content:publish` |

The UI hides the composer from roles without `content:create` (viewers), but the API must
enforce this itself.

- **Ids** are 24-character ObjectId hex strings. Timestamps are ISO-8601 UTC.

## 2. Capability flags (frontend)

| Flag (Vite env, `apps/web`)    | Enables                               | Default |
| ------------------------------ | ------------------------------------- | ------- |
| `VITE_COMPOSER_SERVER_DRAFTS`  | §4 drafts (content packages)          | off     |
| `VITE_COMPOSER_MEDIA_UPLOAD`   | §5 media upload                       | off     |
| `VITE_COMPOSER_SERVER_PRESETS` | §6 workspace account presets          | off     |
| _(none)_                       | §7 publishing: hard-wired off in code | off     |

When a flag is off, the composer:

- keeps the feature in the browser where that is genuinely possible, and labels it that way:
  - drafts autosave to `localStorage`, labelled "Saved in this browser";
  - presets are saved in this browser;
  - media stays in the tab, labelled "In this browser" and "not uploaded";
- never sends the request.

Turning a flag on is the only frontend change needed once an endpoint matches this contract.

## 3. Social accounts (existing; consumed as-is)

`GET /workspaces/:id/social-accounts` is used unchanged, with no query parameters:

- Phase 3 returns up to 500 accounts by default. The composer does not page beyond that.
- **Preferred: `health`** (Phase 3): `health.connectionStatus`, `health.connectionStatusReason`,
  `health.readiness`, `health.readinessReasons[]`, `health.attention[]` and
  `health.needsAttention`.
- **Fallback** for servers that don't send `health` yet: the stored `connectionStatus`,
  `connectionStatusReason`, `publishingStatus` and `publishingStatusReason`.
- **Other fields read:** `id`, `platform`, `name`, `username`, `pictureUrl`, `category`,
  `instagramAccountType`, `connection.displayName`, and `linkedPage.name` (or
  `linkedFacebookPageName`).
- Accounts that are not `ACTIVE`, or whose readiness is not `READY`, stay selectable for
  drafts. They show as a blocking issue in the readiness check.
- Under Phase 3's least-privilege access, an editor may have zero accounts. The composer shows
  "No social accounts have been assigned to you yet".

## 4. Drafts: content packages

A draft is a `ContentPackage` in status `DRAFT`, as `docs/ARCHITECTURE.md` plans. This
proposal stores the intended destinations and per-platform captions on the package, so a
draft can be reopened exactly as it was left. A `Post` (§7) is created only when someone
publishes.

### 4.1 `ContentPackageInput` (create/update body)

```jsonc
{
  "caption": "Summer sale starts today ☀️", // string, may be "" (max 63,206 code points)
  "platformCaptions": {
    // only customized platforms are present
    "INSTAGRAM_ACCOUNT": "Summer sale ☀️ Link in bio", // string; absent key = uses `caption`
  },
  "hashtags": ["summer", "sale"], // without '#', ≤ 60, each ≤ 100 chars,
  // /^[\p{L}\p{M}\p{N}_]+$/u, unique (case-insensitive)
  "hashtagPlacement": "CAPTION", // "CAPTION" | "FIRST_COMMENT"
  "keywords": ["summer campaign", "retail"], // INTERNAL SEO keywords: ≤ 25, each ≤ 60 chars;
  // never published to Meta
  "firstComment": "Shop now: https://example.com", // string, may be ""
  "media": [
    // ordered; first item is the cover
    { "mediaId": "665f…", "altText": "Two models on a beach" }, // altText ≤ 1000 chars
  ],
  "targetAccountIds": ["665a…", "665b…"], // social account ids, all accessible to caller
}
```

Validation rules for the server:

- A draft may be incomplete. Every field may be empty, and no platform rule blocks saving.
- Validation covers shape and limits only. Platform rules (§8) apply when publishing (§7),
  not when saving.
- Every `mediaId` must be a media asset (§5) of the same workspace whose status is `READY` or
  `PROCESSING`. A `FAILED` or unknown asset is a `422`.
- `platformCaptions` and every list are **full replacements**, never merged. A platform that is
  absent from `platformCaptions` uses `caption`, so "Use the shared caption" works by leaving
  that platform out.
- `targetAccountIds` must all pass `accessibleAccountFilter`.

### 4.2 `ContentPackage` (response)

```jsonc
{
  "id": "6660…",
  "status": "DRAFT",
  "version": 3,                       // increments on every successful update (optimistic concurrency)
  "caption": "…", "platformCaptions": { … }, "hashtags": [ … ], "hashtagPlacement": "CAPTION",
  "keywords": [ … ], "firstComment": "…", "targetAccountIds": [ … ],
  "media": [
    { "mediaId": "665f…", "altText": "…", "media": { /* MediaAsset, §5.2 */ } }
  ],
  "createdBy": { "id": "…", "name": "Ada Lovelace" },
  "updatedBy": { "id": "…", "name": "Ada Lovelace" },
  "createdAt": "2026-11-20T10:00:00.000Z",
  "updatedAt": "2026-11-20T10:05:00.000Z"
}
```

A draft is returned only to readers who may use **every** account in its
`targetAccountIds` (owners and admins always may). Other drafts are not returned at all, so a
draft never reveals another member's accounts or unpublished content (see §11, "Drafts").

### 4.3 Endpoints

| Method | Path                                                         | Body                                | Success                                                                                             |
| ------ | ------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/workspaces/:id/content-packages?status=DRAFT&cursor&limit` | –                                   | `200 { items: ContentPackage[], nextCursor }`, newest `updatedAt` first, `limit` ≤ 100 (default 20) |
| POST   | `/workspaces/:id/content-packages`                           | `ContentPackageInput`               | `201 { contentPackage }`                                                                            |
| GET    | `/workspaces/:id/content-packages/:packageId`                | –                                   | `200 { contentPackage }`                                                                            |
| PATCH  | `/workspaces/:id/content-packages/:packageId`                | `ContentPackageInput & { version }` | `200 { contentPackage }`                                                                            |
| DELETE | `/workspaces/:id/content-packages/:packageId`                | –                                   | `204`                                                                                               |

- `PATCH` replaces every content field (it is a full save from the composer, not a merge) and
  requires `version`. When the stored version differs, return
  `409 { error: { code: "CONFLICT", message } }`. The composer then shows "Someone else saved
  this draft. Reload it to see their changes." and does not overwrite.
- Who may edit or delete a draft: any member with `content:create` who can access all of its
  `targetAccountIds`. The backend team decides whether editors may delete other people's
  drafts. The composer only needs a `403`/`404` with a clear message.
- Activity log: proposed new actions `content_package.created`, `content_package.updated`
  and `content_package.deleted`. Their enum values belong in `packages/shared` (backend-owned).
- Frontend: `listDrafts`, `createDraft`, `getDraft`, `updateDraft(ws, id, input, version)` and
  `deleteDraft` in `services/composerApi.js`. `toContentPackageInput` and `fromContentPackage`
  are in `model/serialize.js`.

## 5. Media upload

Media goes **directly to object storage**, not through the JSON API (whose body limit is
100 kB):

1. The API issues a pre-signed upload.
2. The browser `PUT`s the bytes, with progress.
3. The API is told the upload is complete, verifies the object, extracts metadata and marks
   it `READY`.

### 5.1 Endpoints

| Method | Path                                          | Body                                      | Success                                                                                                                                |
| ------ | --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/workspaces/:id/media/uploads`               | `{ fileName, mimeType, sizeBytes, kind }` | `201 { media: { id, status: "PENDING_UPLOAD" }, upload: { url, method: "PUT", headers: { "Content-Type": mimeType, … }, expiresAt } }` |
| PUT    | `upload.url` (storage, **no SocialHub auth**) | raw bytes                                 | `2xx` from storage                                                                                                                     |
| POST   | `/workspaces/:id/media/:mediaId/complete`     | –                                         | `200 { media: MediaAsset }`                                                                                                            |
| GET    | `/workspaces/:id/media/:mediaId`              | –                                         | `200 { media: MediaAsset }`; polled every 3 s while `PROCESSING`                                                                       |
| DELETE | `/workspaces/:id/media/:mediaId`              | –                                         | `204` (`409` if a non-draft post references it)                                                                                        |

**`POST …/media/uploads`:**

- `kind` is `IMAGE` or `VIDEO`.
- `mimeType` is one of `image/jpeg`, `image/png`, `image/gif`, `video/mp4` or
  `video/quicktime`.
- `sizeBytes` limits are proposed SocialHub caps in decimal units: images ≤ 30,000,000 bytes,
  videos ≤ 1,000,000,000 bytes.
- The response to an invalid request is `422` with a field error.

**Uploads are scoped and short-lived:**

- the pre-signed URL is bound to the exact `Content-Type` and size (local storage also
  accepts a body forwarded without `Content-Length`, for example chunked by a proxy, and
  counts the bytes it receives);
- it expires within about 15 minutes;
- it is single-object, and the key is generated by the server;
- with `STORAGE_DRIVER=local`, `upload.url` is a same-origin path
  (`/api/v1/storage/uploads/…`) that the browser resolves against the page, so it works
  whether SocialHub is opened on localhost, a tunnel or a domain. With `s3` it is an
  absolute presigned URL.

**`/complete` verifies the upload:**

- it checks that the object exists and that its size matches;
- it sniffs the real type from the file's magic bytes, never trusting the client's type;
- it extracts `width`, `height` and `durationSec` (sharp and ffprobe, or equivalent);
- it returns `READY`, `PROCESSING` (for example, a video transcode or thumbnail) or `FAILED`
  with `failureReason`.

**Orphans:** assets that are not referenced by any content package 24 hours after upload may
be deleted.

### 5.2 `MediaAsset`

```jsonc
{
  "id": "665f…",
  "kind": "IMAGE",
  "status": "READY", // PENDING_UPLOAD | PROCESSING | READY | FAILED
  "fileName": "beach.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 2480133,
  "width": 1080,
  "height": 1350,
  "durationSec": null,
  "url": "/api/v1/storage/objects/…?expires=…&signature=…", // for the browser: local storage gives a same-origin link signed for this file, valid 6 hours; S3 gives the public URL
  "thumbnailUrl": "https://…", // poster frame for videos, may equal url for images
  "failureReason": null,
}
```

### 5.3 Requirements imposed by Meta (for the publishing engine)

- **Instagram fetches media by URL.** At publish time, every Instagram image or video must be
  reachable at a **public HTTPS URL**, through the `image_url` / `video_url` parameters. A
  signed URL works if it outlives Meta's fetch and any retries.
  - Resumable upload (`rupload.facebook.com`) is available only for video and only with
    Facebook Login.
- **Facebook unpublished photos expire.** Photos uploaded with `published=false` are deleted
  by Meta after about 24 hours.
  - Drafts must therefore keep media in SocialHub storage, never as Meta photo ids.
  - Upload to Meta only when publishing.
- **Instagram images must be JPEG.** If the media service transcodes PNG/GIF to JPEG for
  Instagram, the frontend rule `INSTAGRAM_ACCOUNT.media.image.mimeTypes` can be relaxed.
  That is a single data change in `constants/platformRules.js`.
- **Facebook video:** the currently documented upload path, the Resumable Upload API, accepts
  `video/mp4` only. MOV would need a transcode for Facebook.

Frontend: `useMediaManager` (`hooks/useMediaManager.js`) runs
`createMediaUpload` → `uploadFileToStorage` (an XHR `PUT` with progress and cancellation) →
`completeMediaUpload` → `getMedia` polling.

- Only media with a server id (`READY`, or still `PROCESSING`) can be referenced by a server
  draft. Files that exist only in the browser are listed as "not included".
- A draft reopened from the server shows each asset's real status: `PROCESSING` and `FAILED`
  (with `failureReason`) are never shown as uploaded.
- `MediaAsset.fileName` should echo the name sent to `POST …/media/uploads`. Without it,
  restored files can only be labelled "Image" or "Video".

## 6. Account presets (workspace-shared)

Phase 3 adds no account groups, so this is a new, small resource: a named set of social
accounts that composers reuse ("All retail Pages", "Brand A Instagram").

| Method | Path                                        | Body                         | Success                          |
| ------ | ------------------------------------------- | ---------------------------- | -------------------------------- |
| GET    | `/workspaces/:id/account-presets`           | –                            | `200 { items: AccountPreset[] }` |
| POST   | `/workspaces/:id/account-presets`           | `{ name, socialAccountIds }` | `201 { preset: AccountPreset }`  |
| DELETE | `/workspaces/:id/account-presets/:presetId` | –                            | `204`                            |

The preset rules are:

- **Shape:** `AccountPreset = { id, name, socialAccountIds, createdBy: { id, name }, createdAt }`.
- **`name`:** trimmed, 1–40 characters, unique per workspace (case-insensitive) → `409 CONFLICT`.
- **`socialAccountIds`:** 1–500 entries, all accessible to the creator.
- **Reading:** `socialAccountIds` is filtered to the accounts the reader can access, and the
  composer re-filters against the live account list.
- **Deleting:** by the creator, or by anyone holding `members:manage`. This is a proposal.

Without the flag, presets are stored in the browser, under
`localStorage["sh-composer-presets:v1:<userId>:<workspaceId>"]`, and labelled "Saved in this
browser". **Built-in presets** are computed client-side and need no API: all accounts, all
Facebook Pages, all Instagram accounts, and accounts with publishing access.

## 7. Publishing (future; not built)

The composer only documents the shape here. The engine design is in `docs/ARCHITECTURE.md`
→ "Publishing engine design" (BullMQ, one `PublishingJob` per destination).

### 7.1 Submit

`POST /workspaces/:id/posts` (permission `content:publish`):

```jsonc
// request
{ "contentPackageId": "6660…", "destinations": [{ "socialAccountId": "665a…" }], "scheduledAt": null }
// 202 response
{ "post": { "id": "…", "status": "PENDING",
            "jobs": [{ "id": "…", "socialAccountId": "665a…", "status": "PENDING" }] } }
```

- The server re-validates every destination against §8 and against account health.
- It returns `422` with per-destination issues rather than queueing jobs that will fail.
- Not built. The composer publishes through `POST /publish-jobs` instead
  ([PUBLISHING_API.md](PUBLISHING_API.md)); the frontend's `submitPost` was removed.

### 7.2 First comment

The publishing engine posts the first comment after the post itself succeeds:

| Platform                    | Call                                                                                                       | Required access                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook                    | `POST /{page-post-id}/comments` with `message`, Page access token (the Page is the author)                 | `pages_manage_engagement` and its dependencies `pages_read_user_content` and `pages_show_list`; the Pages comments guide also lists `pages_read_engagement`. MODERATE task on the Page (the guide also lists CREATE_CONTENT)                   |
| Instagram (Facebook Login)  | `POST /{ig-media-id}/comments` with `message`, using the id `media_publish` returns (not the container id) | `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`, `pages_show_list` (plus `ads_management`/`ads_read` if the Page role comes from Business Manager); Community Activity task `PROFILE_PLUS_MODERATE` on the linked Page |
| Instagram (Instagram Login) | same endpoint on `graph.instagram.com`                                                                     | `instagram_business_basic`, `instagram_business_manage_comments`                                                                                                                                                                               |

**Backend dependencies:**

- **Permissions.** None of these comment permissions are in `META_PERMISSIONS` or the
  requested scopes today.
  - They need App Review with Advanced Access, which requires Business Verification, before
    they work for accounts outside the app's roles.
  - A person who may publish may still lack the moderation task, so the first comment can fail
    while the post succeeds.
- **Job status.** The first comment needs its own outcome on the `PublishingJob` (for example
  `firstComment: { status, externalCommentId, lastError }`), so partial success is reported
  accurately. The post must never be re-published because its comment failed.
- **Editing.** Instagram comments cannot be edited, so a change means delete and recreate.
  Facebook comments can be edited.

### 7.3 Caption composition (must match the frontend exactly)

The text a destination receives is computed by `composeCaption` / `composeFirstComment` in
`apps/web/src/features/composer/model/text.js`.

1. **Base text.**
   - Caption: `platformCaptions[platform]` if present, otherwise `caption`.
   - First comment: `firstComment`.
   - Both are trimmed of leading and trailing whitespace.
2. **Hashtags already written.** Hashtags inside a text are matched by
   `(?<![\p{L}\p{M}\p{N}_/&#=?])#([\p{L}\p{M}\p{N}_]+)` (flags `gu`). The lookbehind keeps a
   `#` inside a URL path or query (`/#x`, `?#x`, `=#x`) or an HTML entity from counting.
3. **Hashtag line.** It goes on exactly one text, chosen by `hashtagPlacement`: the caption
   for `CAPTION`, the first comment for `FIRST_COMMENT`.
   - Take the `hashtags` list in order and skip every tag that is already written **in that
     same text**. The comparison is case-insensitive, using `toLowerCase()`.
   - If no tag is left, the text is unchanged.
   - Otherwise join the tags as `#tag` with single spaces. If the text is empty, the result is
     just that line. If not, the result is the text, a blank line (`"\n\n"`), then the line.
4. **Counting.**
   - Characters are counted as Unicode code points.
   - Hashtags are counted per occurrence with the pattern in step 2.
   - @mentions are counted per occurrence with
     `(?<![\p{L}\p{M}\p{N}_.@])@([A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)`, which
     excludes a sentence's full stop after the name.
   - Meta documents none of these counting rules. These are the conservative choices.
5. **Keywords** are never part of any published text.

Worked examples (`hashtags: ["sale", "summer"]`):

| Placement       | Caption           | First comment | Published caption            | Published first comment     |
| --------------- | ----------------- | ------------- | ---------------------------- | --------------------------- |
| `CAPTION`       | `Big #Sale today` | _(empty)_     | `Big #Sale today\n\n#summer` | _(none)_                    |
| `FIRST_COMMENT` | `Big #sale today` | _(empty)_     | `Big #sale today`            | `#sale #summer`             |
| `FIRST_COMMENT` | `Hello`           | `Shop now`    | `Hello`                      | `Shop now\n\n#sale #summer` |

Suggested follow-up: move `model/text.js` into `packages/shared` so the API and web share one
implementation. It has no browser dependencies.

## 8. Platform rules (researched 2026-11-20)

The composer checks these rules client-side, from `constants/platformRules.js`. **The backend
must enforce them as well**: client checks are guidance, and Meta's response is the final
authority.

Every value was researched from Meta's official developer documentation, then independently
re-checked against the cited pages. "Unverified" means no official Meta page states the
value. The composer then shows a warning with "(Not confirmed in Meta's documentation.)" and
never a blocking error.

### Instagram (feed image / carousel / Reel)

| Rule                    | Value                                                                                                           | Status                                                  | Source                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caption length          | 2,200 characters                                                                                                | Verified                                                | [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media): "Maximum 2200 characters, 30 hashtags, and 20 @ tags." |
| Hashtags in caption     | 30 (error)                                                                                                      | Verified                                                | same                                                                                                                                                                         |
| Hashtags (Help Center)  | 5 per post (warning)                                                                                            | Help Center only                                        | [help.instagram.com/351460621611097](https://help.instagram.com/351460621611097): "You can use up to 5 tags on a post." This conflicts with the API reference's 30           |
| @mentions in caption    | 20                                                                                                              | Verified                                                | IG User Media                                                                                                                                                                |
| Media required          | Yes (no text-only posts)                                                                                        | Verified by omission (every container type needs media) | IG User Media / Content Publishing                                                                                                                                           |
| Image format            | JPEG only (no MPO/JPS)                                                                                          | Verified                                                | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/): "JPEG is the only image format supported."                                |
| Image size              | 8 MB                                                                                                            | Verified                                                | IG User Media → Image Specifications                                                                                                                                         |
| Image aspect ratio      | 4:5 – 1.91:1                                                                                                    | Verified                                                | same: "Must be within a 4:5 to 1.91:1 range"                                                                                                                                 |
| Image width             | 320–1440 px, scaled automatically (info only)                                                                   | Verified                                                | same                                                                                                                                                                         |
| Carousel items          | up to 20 (images, videos or mixed)                                                                              | Verified                                                | Content Publishing: "Carousels are limited to 20 images, videos, or a mix of the two."                                                                                       |
| Carousel crop           | all items cropped to the first item's ratio (default 1:1)                                                       | Verified                                                | Content Publishing                                                                                                                                                           |
| Single video            | published as a Reel (`media_type=REELS`; `VIDEO` is for carousel items only)                                    | Verified                                                | IG changelog (Nov 9, 2023)                                                                                                                                                   |
| Reel container / codecs | MP4 or MOV; H.264/HEVC; AAC; 23–60 fps; ≤ 1920 px wide                                                          | Verified                                                | IG User Media → Reel Specifications                                                                                                                                          |
| Reel size / duration    | 300 MB; 3 s – 15 min                                                                                            | Verified                                                | same                                                                                                                                                                         |
| Reel aspect ratio       | 0.01:1 – 10:1 (9:16 recommended, info only)                                                                     | Verified                                                | same                                                                                                                                                                         |
| Carousel video items    | no current spec; legacy values used: 100 MB, 3–60 s, 4:5–16:9                                                   | **Unverified**                                          | Meta's docs no longer publish carousel-video specs                                                                                                                           |
| Alt text                | `alt_text`, ≤ 1000 chars, images only (not Reels/Stories)                                                       | Verified                                                | IG User Media `alt_text`                                                                                                                                                     |
| Publishing rate limit   | 100 API-published posts / 24 h (carousel = 1)                                                                   | Verified, but pages conflict (some still say 50)        | Content Publishing → Rate limit; read `content_publishing_limit` at runtime                                                                                                  |
| First comment length    | 2,200 (industry figure)                                                                                         | **Unverified**                                          | not documented by Meta                                                                                                                                                       |
| First comment @mentions | ≤ 5                                                                                                             | Help Center only (warning)                              | [help.instagram.com/161863397286564](https://help.instagram.com/161863397286564): "You can't include more than 5 @ mentions in a single comment."                            |
| First comment hashtags  | warns above 5                                                                                                   | Help Center pages conflict (warning)                    | [351460621611097](https://help.instagram.com/351460621611097) says 5 per post; [161863397286564](https://help.instagram.com/161863397286564) says 30 per comment             |
| First comment (other)   | no duplicate comments; Instagram filters some words and phrases; comments can't be edited (delete and recreate) | Help Center / IG Comments reference                     |                                                                                                                                                                              |

### Facebook Page

| Rule                         | Value                                                                                             | Status                                                       | Source                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Post text length             | 63,206 characters                                                                                 | **Unverified** (third-party figure; Meta documents no limit) | [Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/)                              |
| Text-only / link posts       | allowed (`message` or `link` required)                                                            | Verified                                                     | Page Feed: "Either link or message must be supplied."                                                         |
| Photo formats                | JPEG, BMP, PNG, GIF, TIFF (GIF published as a still image)                                        | Verified                                                     | [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)                          |
| Photo size                   | < 10 MB (PNG ≤ 1 MB recommended, info only)                                                       | Verified                                                     | Page Photos: "Files can not exceed 10MB."                                                                     |
| Photos per post              | no documented maximum                                                                             | Not enforced                                                 | Page Photos / Page Feed                                                                                       |
| Photos and video in one post | not supported through the API                                                                     | **Unverified** (warning)                                     | only photo `attached_media` is documented                                                                     |
| Videos per post              | 1                                                                                                 | **Unverified** (warning)                                     | videos publish via `/{page-id}/videos`                                                                        |
| Video format                 | MP4 via the documented Resumable Upload API (MOV → warning)                                       | **Unverified** for MOV                                       | [Video API upload](https://developers.facebook.com/docs/video-api/guides/publishing)                          |
| Video size / duration        | 10 GB / 4 h (historical)                                                                          | **Unverified**                                               | archived Video API guide; current docs state none (`GET /me?fields=video_upload_limits` gives runtime values) |
| Video aspect ratio           | 9:16 – 16:9                                                                                       | **Unverified**                                               | Video API reference                                                                                           |
| Alt text                     | `alt_text_custom` at upload (photos can't be updated later)                                       | Verified                                                     | Page Photos                                                                                                   |
| Caption parameter            | `/feed` → `message`; `/photos` → `caption`; `/videos` and `/video_reels` → `description`          | Verified                                                     | respective references                                                                                         |
| Publish access               | Page token; `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`; CREATE_CONTENT task | Verified                                                     | Page Feed                                                                                                     |
| Reels (if used)              | 3–90 s, 9:16, 30 API reels per Page per 24 h                                                      | Verified                                                     | [Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing)                    |

## 9. Backend dependencies (summary)

1. **Content packages API** (§4) with optimistic concurrency, access filtering and
   activity-log actions.
2. **Media API** (§5):
   - pre-signed direct upload, server-side type sniffing and metadata extraction, and orphan
     cleanup;
   - **public HTTPS URLs at publish time** for Instagram.
3. **Account presets API** (§6).
4. **Publishing engine** (§7). It re-validates against §8, and composes text exactly as §7.3
   describes, ideally from shared code.
5. **New Meta permissions for first comments** (§7.2): `pages_manage_engagement` and
   `pages_read_user_content` (Facebook), `instagram_manage_comments` (Instagram with Facebook
   Login) and `instagram_business_manage_comments` (Instagram Login). Commenting also needs the
   MODERATE / PROFILE_PLUS_MODERATE task.
   - Add them to `META_PERMISSIONS`, with scope requests and App Review.
   - Surface missing ones through `health.eligibility.missingPermissions`, so the composer can
     flag first-comment problems per account.
6. **Content-Security-Policy** for the API-served web app (`apps/api/src/app.js`):
   - **Done (2026-11-20):** `img-src` and `media-src` allow `blob:`. The composer previews
     attached files from `blob:` object URLs and reads their dimensions the same way.
   - **Open:** when the media API ships, `connect-src` must allow the object-storage origin,
     or the browser's direct `PUT` upload is blocked.
7. **Sign-out and browser drafts.** The composer removes a person's browser drafts when they
   sign out from the sidebar menu. Any other sign-out path the app adds (for example "sign out
   everywhere") should call `clearLocalDraftsForUser(userId)` from
   `features/composer/services/localStore.js` too.
8. **Shared schemas** in `packages/shared`: `contentPackageInputSchema` (mirroring §4.1),
   `mediaUploadRequestSchema` and `accountPresetSchema`, plus the activity-log enum values.

## 10. Frontend integration checklist

When an endpoint ships:

1. Confirm the response shapes above, or update `services/composerApi.js` and
   `model/serialize.js`.
2. Set the matching `VITE_COMPOSER_*` flag in the web app's environment.
3. Run `npm run test:web`. The tests that use `vi.stubEnv` already exercise each enabled path
   against these shapes.
4. For publishing: build the submission UX and the per-destination job status view. Then
   replace the hard-wired `publishing: false` in `services/capabilities.js` with a flag.

## 11. Implementation notes (2026-11-21)

What the API in `apps/api` does where the proposal above was open or has changed. Where this
section and an earlier one disagree, this section is right.

### Where the code is

| Area                              | Files                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared limits and request schemas | `packages/shared/src/composer.js` (`contentPackageInputSchema`, `contentPackageUpdateSchema`, `contentPackageQuerySchema`, `mediaUploadRequestSchema`, `accountPresetSchema`, `COMPOSER_LIMITS`) |
| Drafts                            | `apps/api/src/modules/contentPackages/`, model `ContentPackage`                                                                                                                                  |
| Media                             | `apps/api/src/modules/media/`, model `MediaAsset`, storage drivers in `apps/api/src/storage/`                                                                                                    |
| Presets                           | `apps/api/src/modules/accountPresets/`, model `AccountPreset`                                                                                                                                    |

### Drafts (§4)

- **Paging.** `cursor` is an opaque string taken from `nextCursor`. It is not an ObjectId.
- **Conflict.** A stale `version` answers `409 CONFLICT` with
  `details: { currentVersion }` and writes nothing. The version check and the write are one
  atomic database operation, so of several simultaneous saves exactly one succeeds.
- **Who may see a draft.** Owners, admins and members with access to all accounts see every
  draft. Editors and viewers with selected accounts see a draft only if they may use every
  account it targets; a draft with no accounts follows `content:read` alone. Hidden drafts
  are filtered inside the list query and answer `404 Draft not found` (like an unknown id)
  to read, update, delete and publish. Accounts removed from the workspace no longer
  restrict anyone. Implemented in `contentPackages/contentAccess.js`; tests in
  `apps/api/test/draftPrivacy.test.js`.
- **Who may change a draft.** A member with `content:create` who can see it (above). Viewers
  get `403`. Any such member may delete the draft, not only its author.
- **Unavailable accounts.** A `targetAccountIds` entry the caller cannot use is `422` with a
  `targetAccountIds` field message. The composer leaves such accounts out before saving.
- **Media.** Every `mediaId` must be a `READY` (or `PROCESSING`) asset of the same
  workspace, otherwise `422` with a `media` field message.
- **Size.** Draft requests may be up to 1 MB (other routes: 100 kB), because four texts of
  63,206 characters can take 3–4 bytes per character.
- **First comment.** At most 8,000 characters are stored.
- **Activity log.** `content_package.created` and `.deleted` are always logged.
  `content_package.updated` is logged at most once per draft every 10 minutes, so autosave
  does not flood the log. Entries hold counts only, never the text.
- **Autosave (composer).** Once a team draft exists, the composer saves later edits 3 seconds
  after the last change, sending the version it last saw. It never creates a draft by itself
  and stops after a conflict or an error until the person saves by hand. The browser draft
  keeps running as a fallback.

### Media (§5)

- **Statuses.** Verification happens inside `/complete`, so an asset goes from
  `PENDING_UPLOAD` straight to `READY` or `FAILED`. `PROCESSING` is reserved for a future
  transcoding step and is not produced today.
- **Not uploaded yet.** `/complete` before the file is in storage answers
  `409 UPLOAD_INCOMPLETE` and leaves the slot open, so an interrupted upload can be sent again.
- **Verification.** The object must exist and have exactly the announced size. Its real type
  is read from its first bytes: images must be exactly the declared format, videos must be an
  MP4/MOV container. Images must have readable dimensions. No side may exceed 20,000 px. A
  file that fails is removed from storage and marked `FAILED` with `failureReason`.
- **Dimensions and duration** are parsed from the file headers (JPEG, PNG, GIF, MP4/MOV). No
  image or video library is installed. Video dimensions and duration can therefore be `null`
  for unusual files.
- **Thumbnails are not generated.** `thumbnailUrl` equals `url` for images and is `null`
  for videos.
- **`fileName`** is returned on every asset.
- **Deleting.** Allowed for the uploader or a member with `members:manage`. `409` while a
  draft uses the file.
- **Storage errors.** `503 STORAGE_NOT_CONFIGURED` when no driver is set;
  `502 STORAGE_UNAVAILABLE` when the provider fails. Neither marks anything as uploaded.
- **Clean-up.** `npm run media:cleanup -w @socialhub/api` removes upload slots that expired
  more than an hour ago without being completed, and verified or failed files older than
  24 hours that no draft uses. Schedule it (for example hourly).

### 5.4 Storage configuration

Set on the API (`apps/api/.env`); nothing here reaches the browser.

| Variable                                                   | Meaning                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`                                           | `s3`, `local`, or empty (uploads disabled)                                       |
| `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`                   | Bucket and region (default `us-east-1`)                                          |
| `STORAGE_S3_ENDPOINT`                                      | Only for non-AWS providers (Cloudflare R2, MinIO)                                |
| `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | Credentials with put, get, head and delete on the bucket                         |
| `STORAGE_S3_FORCE_PATH_STYLE`                              | `true` for MinIO and most custom endpoints (the default when an endpoint is set) |
| `STORAGE_PUBLIC_BASE_URL`                                  | Public HTTPS base URL of the bucket or its CDN. Required for `s3`                |
| `STORAGE_LOCAL_DIR`                                        | Directory for `local` (default `./storage-data`)                                 |
| `STORAGE_UPLOAD_TTL_SECONDS`                               | Lifetime of an upload link (default 900)                                         |

- **`s3`** issues presigned `PUT` URLs bound to one server-generated key, the content type
  and the exact content length. The bucket needs a CORS rule allowing `PUT` with the
  `Content-Type` header from the web app's origin. The API adds the bucket origin to the
  Content-Security-Policy `connect-src`, and no other origin.
- **`local`** stores files on the API server and serves them from
  `/api/v1/storage/objects/…`, only with a link signed for that exact file that has not
  expired (`?expires=…&signature=…`). Links for the browser are same-origin paths valid for
  6 hours; links handed to Meta are absolute, on `API_PUBLIC_URL`, valid for 2 hours. A
  missing, tampered or other file's signature gets `404` (as if the file did not exist), an
  expired link `403`. Meta can only fetch the files when `API_PUBLIC_URL` is a public HTTPS
  address (for example a tunnel); it is meant for development.

### Presets (§6)

- Implemented as proposed. Names are unique per workspace regardless of case
  (`409 CONFLICT` with a `name` field message). There is no update endpoint: delete and
  create again.

### Upload links and overwriting (fixed 2026-11-21)

**The problem.** An upload link stays valid until it expires (15 minutes by default) and S3
overwrites on `PUT`. The link used to point at the same object the API verified and served,
so its holder could replace a verified file with other bytes of the same size and type.

**The two options that were considered:**

| Option                                                        | Verdict                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign `If-None-Match: *` into the upload                       | Not chosen. It depends on the provider supporting conditional writes, needs an extra CORS header, and a provider that ignores the header leaves the hole open without any sign of it. |
| Record the ETag at verification and compare before publishing | Not chosen as the fix. It only detects a swap later: the public URL would serve the swapped bytes in the meantime.                                                                    |

**What was implemented: a separate upload key, then copy and verify.**

1. Every asset gets two server-generated keys: `uploads/<workspace>/<id>/<random>` for the
   upload, and `workspaces/<workspace>/media/<id>/<random>` for the final file.
2. The upload link is signed for the **upload key only**. No link is ever issued for the
   final key.
3. `/complete` takes a short claim on the asset, so only one completion request works on it
   at a time. Others get `409 CONFLICT` ("being verified") or the finished result.
4. The API copies the upload object to the final key (a server-side `CopyObject`).
5. It verifies the bytes **at the final key**: announced size, real type, dimensions. What
   becomes `READY` is exactly what was checked.
6. `READY` and `FAILED` are final. The final object is never copied over again.

The frontend contract is unchanged: same request, same `{ url, method, headers }` answer.

**What this guarantees (in the API's logic):**

- A verified file cannot be changed through its upload link, expired or not. Reusing the
  link can only rewrite the upload object, which nothing refers to.
- Swapping the upload object during completion cannot produce a `READY` asset with
  unverified bytes: either the swap lands before the copy and those bytes are judged, or it
  lands after and never reaches the final key.
- A link cannot be re-pointed at another key, type or size: the signature covers the path
  and the `content-type` and `content-length` headers.
- Failed verification removes the object under both keys.
- A storage outage during completion leaves the asset `PENDING_UPLOAD` and retryable.

**Local driver.** Unchanged for callers: a link writes its file once and answers `409`
afterwards. It follows the same copy-and-verify flow.

**Clean-up.** `media:cleanup` also removes upload objects of finished assets once their
link has expired (a reused link may have left one behind).

**Recommended bucket policy.** Make only the `workspaces/` prefix publicly readable. Files
under `uploads/` are unverified and need no public access. Keep bucket listing disabled.

**Verification status.** The behaviour above is proven by automated tests against a
**simulated** S3 provider that checks signatures and link expiry and overwrites on `PUT`
(`apps/api/test/media.s3.test.js`). **It has not been run against a real bucket.**

### Setting up the bucket

Replace `BUCKET` and the origin with your own values. JSON below is AWS S3 syntax; other
providers have the same three settings under their own names.

**1. Access key permissions (least privilege).** The API's key needs exactly these:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::BUCKET/uploads/*", "arn:aws:s3:::BUCKET/workspaces/*"]
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::BUCKET",
      "Condition": { "StringLike": { "s3:prefix": ["uploads/*", "workspaces/*"] } }
    }
  ]
}
```

- `s3:ListBucket` is for the API's key only. It does **not** make the bucket publicly
  listable. Without it S3 answers `403` instead of `404` for an object that does not exist,
  and the API cannot tell "not uploaded yet" from "not allowed". The API itself never lists.
- Server-side copy needs `GetObject` on the source and `PutObject` on the destination, which
  the first statement covers.

**2. Public read for final media only.** Meta and browsers read `workspaces/*`. Nothing else
is public, and listing stays off:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadVerifiedMedia",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET/workspaces/*"
    }
  ]
}
```

- On AWS, "Block public access" must allow bucket policies for this to take effect. Leave
  the ACL settings blocked.
- Do not grant `s3:ListBucket` to `*`.
- `uploads/*` holds unverified files and must stay private.
- With a CDN in front, point `STORAGE_PUBLIC_BASE_URL` at the CDN and let only the CDN read
  the bucket.

**3. CORS, for the browser's direct upload.** Use the web app's real origin, the one people
type in the address bar (for local development that is `http://localhost:5173`):

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

- Only `PUT` is needed: reading uses the public URL, and everything else is done by the API.
- Do not use `*` as the origin.

**4. Optional safety net.** A lifecycle rule that expires objects under `uploads/` after one
day. The API's clean-up already removes them; the rule covers the case where the clean-up
is not scheduled.

**Provider notes** (from the providers' documentation; **none of this has been run**):

| Provider         | Settings                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AWS S3           | Leave `STORAGE_S3_ENDPOINT` empty. Set the bucket's real region. Bucket names with dots do not work with HTTPS virtual-hosted URLs; avoid them.                                                                                                                                                                    |
| Cloudflare R2    | `STORAGE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_S3_REGION=auto`. Public delivery needs a custom domain or the `r2.dev` URL as `STORAGE_PUBLIC_BASE_URL`. R2 has no bucket policies: public access is per bucket, so use a separate bucket for uploads if `uploads/` must be private. |
| MinIO and others | Set the endpoint; path-style addressing is the default when an endpoint is set.                                                                                                                                                                                                                                    |

**Scheduling the clean-up.** Run it hourly.

- Linux (cron): `0 * * * * cd /path/to/socialhub && npm run media:cleanup -w @socialhub/api`
- Windows (Task Scheduler): an hourly task that runs
  `npm run media:cleanup -w @socialhub/api` in the repository folder.

It never deletes a file that a draft uses. Each run removes abandoned uploads (links that
expired more than an hour ago), files no draft has used for 24 hours, and temporary upload
objects whose link has expired.

### Real-bucket verification status

**BLOCKED as of 2026-11-21: no storage is configured** (`apps/api/.env` has no `STORAGE_*`
values), so no request has ever been sent to a real bucket.

| Check                                                              | Status                         |
| ------------------------------------------------------------------ | ------------------------------ |
| Signed upload link, bound to key, type and size                    | Blocked (simulated tests only) |
| Upload, stored size                                                | Blocked                        |
| Server-side copy to the final key                                  | Blocked                        |
| Ranged reads                                                       | Blocked                        |
| Public HTTPS delivery                                              | Blocked                        |
| Link reuse with a same-size file leaves the final object unchanged | Blocked (simulated tests only) |
| Link cannot target the final key                                   | Blocked (simulated tests only) |
| CORS                                                               | Blocked                        |
| Bucket not listable                                                | Blocked                        |
| Deletion                                                           | Blocked                        |
| Upload from the composer in a real browser                         | Blocked                        |

Record the provider, the date and the script's output here once it has been run.

### Verifying a real bucket

```bash
# 1. In apps/api/.env set STORAGE_DRIVER=s3 and the STORAGE_S3_* variables,
#    plus STORAGE_PUBLIC_BASE_URL.
# 2. Run:
npm run storage:verify -w @socialhub/api
```

The script makes real requests with the same driver the API uses. It writes two small test
objects under `uploads/_verify/` and `workspaces/_verify/` and deletes them at the end. It
never prints credentials or signed URLs. It checks, in order:

1. The link refuses another `Content-Type` and another size.
2. **Upload** through the signed link.
3. **Completion steps:** stored size, server-side copy to the final key, ranged read.
4. **Public delivery:** the final object is served over HTTPS from `STORAGE_PUBLIC_BASE_URL`.
5. **Reusing the same upload link** with a **same-size, different file**, then confirming the
   final object and the publicly served bytes are unchanged.
6. The link cannot be re-pointed at the final key.
7. The bucket's CORS rule allows `PUT` from the web app's origin.
8. The bucket is not listable.
9. **Deletion**, and that the object is no longer served.

Exit code `0` means every required check passed. Only then is S3 verified for that bucket.
After that, do one upload from the composer itself with `VITE_COMPOSER_MEDIA_UPLOAD=true`,
since the script cannot exercise a real browser's CORS handling.

### Open items

1. **Publishing engine** (§7) and the Meta permissions for first comments (§7.2).
2. **Live S3 verification.** Run one upload against the real bucket before relying on it,
   including the bucket CORS rule and the signed `content-length` header.
3. **Close the S3 overwrite window** (see "Upload links and overwriting") before publishing.
4. **Video thumbnails and transcoding** (MOV for Facebook, non-JPEG images for Instagram).
5. **Scheduling the clean-up script**, until the BullMQ worker exists.
