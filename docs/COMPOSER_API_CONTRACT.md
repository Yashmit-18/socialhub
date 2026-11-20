# Composer API contract (proposed)

This document specifies the backend endpoints that the **Universal Post Composer** frontend
(`apps/web/src/features/composer/`, route `/w/:slug/compose`) is built against.

> **Status (2026-11-20)**
>
> - **None of the endpoints in §4–§7 exist in the API yet.** They are proposals from the
>   frontend for the backend team to accept, change or reject.
> - The composer works today without them: composing, validation, previews, account presets
>   and drafts saved **in the browser only**.
> - Each server feature sits behind a frontend capability flag (§2). While a flag is off, the
>   composer never calls that endpoint and never shows a server-side success.
> - **Publishing is not built.** The Publish button is always disabled and `submitPost`
>   always throws, whatever the environment says.

Frontend files that implement this contract:

| File                                       | Role                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `services/composerApi.js`                  | One function per endpoint below; each checks its capability flag first  |
| `services/capabilities.js`                 | Capability flags and the "not available yet" messages                   |
| `model/serialize.js`                       | Composer state ⇄ `ContentPackageInput` / `ContentPackage`               |
| `model/text.js`                            | Caption composition algorithm (§7.3), which the backend must mirror     |
| `model/validation.js`, `constants/platformRules.js` | Client-side platform checks (§8), which the backend must also enforce |

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

| Action                                                  | Permission                        |
| ------------------------------------------------------- | --------------------------------- |
| Open the composer, create/update/delete drafts, upload media, create/delete presets | `content:create` |
| List/read drafts and presets                            | `content:read`                    |
| Submit a post for publishing (§7)                       | `content:publish`                 |

  The UI hides the composer from roles without `content:create` (viewers), but the API must
  enforce this itself.
- **Ids** are 24-character ObjectId hex strings. Timestamps are ISO-8601 UTC.

## 2. Capability flags (frontend)

| Flag (Vite env, `apps/web`)    | Enables                                  | Default |
| ------------------------------ | ---------------------------------------- | ------- |
| `VITE_COMPOSER_SERVER_DRAFTS`  | §4 drafts (content packages)             | off     |
| `VITE_COMPOSER_MEDIA_UPLOAD`   | §5 media upload                          | off     |
| `VITE_COMPOSER_SERVER_PRESETS` | §6 workspace account presets             | off     |
| _(none)_                       | §7 publishing: hard-wired off in code    | off     |

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
  "caption": "Summer sale starts today ☀️",           // string, may be "" (max 63,206 code points)
  "platformCaptions": {                                 // only customized platforms are present
    "INSTAGRAM_ACCOUNT": "Summer sale ☀️ Link in bio"   // string; absent key = uses `caption`
  },
  "hashtags": ["summer", "sale"],                      // without '#', ≤ 60, each ≤ 100 chars,
                                                        // /^[\p{L}\p{M}\p{N}_]+$/u, unique (case-insensitive)
  "hashtagPlacement": "CAPTION",                        // "CAPTION" | "FIRST_COMMENT"
  "keywords": ["summer campaign", "retail"],           // INTERNAL SEO keywords: ≤ 25, each ≤ 60 chars;
                                                        // never published to Meta
  "firstComment": "Shop now: https://example.com",     // string, may be ""
  "media": [                                            // ordered; first item is the cover
    { "mediaId": "665f…", "altText": "Two models on a beach" }   // altText ≤ 1000 chars
  ],
  "targetAccountIds": ["665a…", "665b…"]               // social account ids, all accessible to caller
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

`targetAccountIds` should be filtered to the accounts the **reader** can access, so a draft
never reveals another member's accounts.

### 4.3 Endpoints

| Method | Path                                               | Body                               | Success                                   |
| ------ | -------------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| GET    | `/workspaces/:id/content-packages?status=DRAFT&cursor&limit` | –                      | `200 { items: ContentPackage[], nextCursor }`, newest `updatedAt` first, `limit` ≤ 100 (default 20) |
| POST   | `/workspaces/:id/content-packages`                 | `ContentPackageInput`              | `201 { contentPackage }`                  |
| GET    | `/workspaces/:id/content-packages/:packageId`      | –                                  | `200 { contentPackage }`                  |
| PATCH  | `/workspaces/:id/content-packages/:packageId`      | `ContentPackageInput & { version }`| `200 { contentPackage }`                  |
| DELETE | `/workspaces/:id/content-packages/:packageId`      | –                                  | `204`                                     |

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

| Method | Path                                         | Body                                       | Success |
| ------ | -------------------------------------------- | ------------------------------------------ | ------- |
| POST   | `/workspaces/:id/media/uploads`              | `{ fileName, mimeType, sizeBytes, kind }`  | `201 { media: { id, status: "PENDING_UPLOAD" }, upload: { url, method: "PUT", headers: { "Content-Type": mimeType, … }, expiresAt } }` |
| PUT    | `upload.url` (storage, **no SocialHub auth**) | raw bytes                                  | `2xx` from storage |
| POST   | `/workspaces/:id/media/:mediaId/complete`    | –                                          | `200 { media: MediaAsset }` |
| GET    | `/workspaces/:id/media/:mediaId`             | –                                          | `200 { media: MediaAsset }`; polled every 3 s while `PROCESSING` |
| DELETE | `/workspaces/:id/media/:mediaId`             | –                                          | `204` (`409` if a non-draft post references it) |

**`POST …/media/uploads`:**

- `kind` is `IMAGE` or `VIDEO`.
- `mimeType` is one of `image/jpeg`, `image/png`, `image/gif`, `video/mp4` or
  `video/quicktime`.
- `sizeBytes` limits are proposed SocialHub caps in decimal units: images ≤ 30,000,000 bytes,
  videos ≤ 1,000,000,000 bytes.
- The response to an invalid request is `422` with a field error.

**Uploads are scoped and short-lived:**

- the pre-signed URL is bound to the exact `Content-Type` and `Content-Length`;
- it expires within about 15 minutes;
- it is single-object, and the key is generated by the server.

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
  "id": "665f…", "kind": "IMAGE", "status": "READY",      // PENDING_UPLOAD | PROCESSING | READY | FAILED
  "fileName": "beach.jpg", "mimeType": "image/jpeg", "sizeBytes": 2480133,
  "width": 1080, "height": 1350, "durationSec": null,
  "url": "https://…",            // URL the browser can display (signed is fine)
  "thumbnailUrl": "https://…",   // poster frame for videos, may equal url for images
  "failureReason": null
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

| Method | Path                                       | Body                              | Success |
| ------ | ------------------------------------------ | --------------------------------- | ------- |
| GET    | `/workspaces/:id/account-presets`          | –                                 | `200 { items: AccountPreset[] }` |
| POST   | `/workspaces/:id/account-presets`          | `{ name, socialAccountIds }`      | `201 { preset: AccountPreset }` |
| DELETE | `/workspaces/:id/account-presets/:presetId`| –                                 | `204` |

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
- The frontend's `submitPost` exists, but the `publishing` capability is hard-wired `false`,
  so it is never called in this release.

### 7.2 First comment

The publishing engine posts the first comment after the post itself succeeds:

| Platform  | Call | Required access |
| --------- | ---- | --------------- |
| Facebook  | `POST /{page-post-id}/comments` with `message`, Page access token (the Page is the author) | `pages_manage_engagement` and its dependencies `pages_read_user_content` and `pages_show_list`; the Pages comments guide also lists `pages_read_engagement`. MODERATE task on the Page (the guide also lists CREATE_CONTENT) |
| Instagram (Facebook Login) | `POST /{ig-media-id}/comments` with `message`, using the id `media_publish` returns (not the container id) | `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`, `pages_show_list` (plus `ads_management`/`ads_read` if the Page role comes from Business Manager); Community Activity task `PROFILE_PLUS_MODERATE` on the linked Page |
| Instagram (Instagram Login) | same endpoint on `graph.instagram.com` | `instagram_business_basic`, `instagram_business_manage_comments` |

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

1. **Base text.** It is `platformCaptions[platform]` if present, otherwise `caption`, with
   leading and trailing whitespace trimmed.
2. **Hashtag line.** If `hashtagPlacement` is `CAPTION`, append the hashtags that are not
   already written in the base text. The comparison is case-insensitive, and hashtags in the
   text are matched by `(?<![\p{L}\p{M}\p{N}_/&#])#([\p{L}\p{M}\p{N}_]+)`. The hashtags go on
   their own line, after a blank line (`"\n\n"`), as `#tag` joined by single spaces.
3. **First comment.** It is `firstComment`, trimmed. When `hashtagPlacement` is
   `FIRST_COMMENT`, the same hashtag line is appended to it instead.
4. **Counting.** Characters are counted as Unicode code points. Hashtags and @mentions are
   counted per occurrence. Meta documents neither rule, and these are the conservative choices.
5. **Keywords** are never part of any published text.

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

| Rule | Value | Status | Source |
| ---- | ----- | ------ | ------ |
| Caption length | 2,200 characters | Verified | [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media): "Maximum 2200 characters, 30 hashtags, and 20 @ tags." |
| Hashtags in caption | 30 (error) | Verified | same |
| Hashtags (Help Center) | 5 per post (warning) | Help Center only | [help.instagram.com/351460621611097](https://help.instagram.com/351460621611097): "You can use up to 5 tags on a post." This conflicts with the API reference's 30 |
| @mentions in caption | 20 | Verified | IG User Media |
| Media required | Yes (no text-only posts) | Verified by omission (every container type needs media) | IG User Media / Content Publishing |
| Image format | JPEG only (no MPO/JPS) | Verified | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/): "JPEG is the only image format supported." |
| Image size | 8 MB | Verified | IG User Media → Image Specifications |
| Image aspect ratio | 4:5 – 1.91:1 | Verified | same: "Must be within a 4:5 to 1.91:1 range" |
| Image width | 320–1440 px, scaled automatically (info only) | Verified | same |
| Carousel items | up to 20 (images, videos or mixed) | Verified | Content Publishing: "Carousels are limited to 20 images, videos, or a mix of the two." |
| Carousel crop | all items cropped to the first item's ratio (default 1:1) | Verified | Content Publishing |
| Single video | published as a Reel (`media_type=REELS`; `VIDEO` is for carousel items only) | Verified | IG changelog (Nov 9, 2023) |
| Reel container / codecs | MP4 or MOV; H.264/HEVC; AAC; 23–60 fps; ≤ 1920 px wide | Verified | IG User Media → Reel Specifications |
| Reel size / duration | 300 MB; 3 s – 15 min | Verified | same |
| Reel aspect ratio | 0.01:1 – 10:1 (9:16 recommended, info only) | Verified | same |
| Carousel video items | no current spec; legacy values used: 100 MB, 3–60 s, 4:5–16:9 | **Unverified** | Meta's docs no longer publish carousel-video specs |
| Alt text | `alt_text`, ≤ 1000 chars, images only (not Reels/Stories) | Verified | IG User Media `alt_text` |
| Publishing rate limit | 100 API-published posts / 24 h (carousel = 1) | Verified, but pages conflict (some still say 50) | Content Publishing → Rate limit; read `content_publishing_limit` at runtime |
| First comment length | 2,200 (industry figure) | **Unverified** | not documented by Meta |
| First comment @mentions | ≤ 5 | Help Center only (warning) | [help.instagram.com/161863397286564](https://help.instagram.com/161863397286564): "You can't include more than 5 @ mentions in a single comment." |
| First comment hashtags | warns above 5 | Help Center pages conflict (warning) | [351460621611097](https://help.instagram.com/351460621611097) says 5 per post; [161863397286564](https://help.instagram.com/161863397286564) says 30 per comment |
| First comment (other) | no duplicate comments; Instagram filters some words and phrases; comments can't be edited (delete and recreate) | Help Center / IG Comments reference | |

### Facebook Page

| Rule | Value | Status | Source |
| ---- | ----- | ------ | ------ |
| Post text length | 63,206 characters | **Unverified** (third-party figure; Meta documents no limit) | [Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/) |
| Text-only / link posts | allowed (`message` or `link` required) | Verified | Page Feed: "Either link or message must be supplied." |
| Photo formats | JPEG, BMP, PNG, GIF, TIFF (GIF published as a still image) | Verified | [Page Photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/) |
| Photo size | < 10 MB (PNG ≤ 1 MB recommended, info only) | Verified | Page Photos: "Files can not exceed 10MB." |
| Photos per post | no documented maximum | Not enforced | Page Photos / Page Feed |
| Photos and video in one post | not supported through the API | **Unverified** (warning) | only photo `attached_media` is documented |
| Videos per post | 1 | **Unverified** (warning) | videos publish via `/{page-id}/videos` |
| Video format | MP4 via the documented Resumable Upload API (MOV → warning) | **Unverified** for MOV | [Video API upload](https://developers.facebook.com/docs/video-api/guides/publishing) |
| Video size / duration | 10 GB / 4 h (historical) | **Unverified** | archived Video API guide; current docs state none (`GET /me?fields=video_upload_limits` gives runtime values) |
| Video aspect ratio | 9:16 – 16:9 | **Unverified** | Video API reference |
| Alt text | `alt_text_custom` at upload (photos can't be updated later) | Verified | Page Photos |
| Caption parameter | `/feed` → `message`; `/photos` → `caption`; `/videos` and `/video_reels` → `description` | Verified | respective references |
| Publish access | Page token; `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`; CREATE_CONTENT task | Verified | Page Feed |
| Reels (if used) | 3–90 s, 9:16, 30 API reels per Page per 24 h | Verified | [Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing) |

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
6. **Shared schemas** in `packages/shared`: `contentPackageInputSchema` (mirroring §4.1),
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
