# Facebook Group sharing (Phase 6)

A manual workflow for sharing posts in Facebook Groups. SocialHub keeps a directory of the
groups your team shares in, turns a post into one task per group, and records who posted it
where. **People post in the groups themselves**: SocialHub never posts to, joins, reads or
scrapes Facebook Groups, and no part of this phase calls Facebook.

Why manual: Meta removed the Groups API, including the `publish_to_groups` permission, in
Graph API v19.0 (announced January 2024). Since spring 2024, apps can no longer post in
groups. See Meta's
[developer community thread](https://developers.facebook.com/community/threads/2076398286093257/)
and [TechCrunch's report](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/).

## Screens

"Group sharing" in the sidebar (`/w/:slug/groups`), with three tabs:

| Tab                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sharing tasks** (`/groups`)             | The work queue. Each task shows the group (link opens Facebook), the group's rules, the text and link to post, the due date and who posts it. Actions: **Copy text**, **Mark as shared** (optionally with the link to the post), **Skip** (with a note), **Take it** (claim an unassigned task), **Reopen**. Tabs for To share, Shared and Skipped, and a filter: mine and unassigned, mine, unassigned, everyone.                                                           |
| **Shares** (`/groups/shares`)             | Posts written once for many groups, newest first, with progress. **New share**: title, text, optional link, groups (search and category filter), who posts it, due date. Groups that cannot get the share are listed with the reason. A share's page (`/groups/shares/:id`) lists every group's task, who posts it (owners and admins can change it), the result and the post link; owners and admins can edit the text, add groups or delete a share that was never posted. |
| **Group directory** (`/groups/directory`) | The groups: name and link, category, relevance tags, approximate members, rules and notes, "days between shares", last shared and when the next share is allowed. Search (name, tag, notes, link), filters (status, category, tag), sorting; owners and admins add, edit, archive, restore and delete groups and manage categories.                                                                                                                                          |

## Rules

- **Group links.** Any `facebook.com/groups/<id-or-name>` address (www, m, web or mbasic, with
  or without `https://`, extra path ignored) is stored as
  `https://www.facebook.com/groups/<id-or-name>/`. The id or name, ignoring case, identifies
  the group: a workspace lists each group once (409 with the existing group's name).
- **Duplicate prevention.** A share reaches each group at most once (unique `(share, group)`
  index; adding a group again is reported as `ALREADY_QUEUED`). A group's **days between
  shares** rule (1–365, optional) blocks new tasks until that many days after the last share
  marked done (`TOO_SOON`, with the date the next share is allowed). Archived groups get no new
  tasks (`ARCHIVED`). A share that no selected group can take is refused (409) and nothing is
  written.
- **History is kept.** A group with a completed share can only be archived, not deleted; a
  share posted in at least one group cannot be deleted (its open tasks can be skipped).
  Deleting a category leaves its groups without a category.
- **Who can do what.**

  | Action                                         | Permission               | Roles                |
  | ---------------------------------------------- | ------------------------ | -------------------- |
  | Read directory, shares and tasks               | `content:read`           | everyone             |
  | Directory, categories, shares, assigning tasks | `groups:manage`          | owner, admin         |
  | Work on tasks                                  | `sharing_tasks:complete` | owner, admin, editor |

  Editors work on tasks assigned to them or to nobody, may take an unassigned task (not give one
  to someone else), and may reopen only what they finished themselves. Tasks can be assigned
  only to members who can complete them. When a member leaves or is removed, their open tasks
  go back to "anyone".

- **Concurrency.** A task update succeeds only if the task did not change meanwhile; two
  people marking the same task done get one success and one 409.
- **Post links** must be `https://` links on facebook.com or fb.com. Share links must be
  `https://`.
- **Limits:** 2,000 groups and 50 categories per workspace, 15 tags per group, 200 groups per
  share request, 5,000 characters of text.
- **Activity log:** group added, updated and removed; share created and deleted; task shared,
  skipped and reopened.

## API

All routes are under `/api/v1/workspaces/:workspaceId`; see the API reference table in the
README for request and response details.

- `GET|POST /group-categories`, `PATCH|DELETE /group-categories/:categoryId`
- `GET|POST /facebook-groups`, `GET|PATCH|DELETE /facebook-groups/:groupId`
- `GET|POST /group-shares`, `GET|PATCH|DELETE /group-shares/:shareId`,
  `POST /group-shares/:shareId/groups`
- `GET /sharing-tasks`, `PATCH /sharing-tasks/:taskId`

## Data model

| Model           | Purpose                                                                              | Key indexes                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `GroupCategory` | Directory categories                                                                 | unique `{workspace, nameKey}`                                                                                              |
| `FacebookGroup` | Directory entry; `lastSharedAt` is kept in step with done tasks                      | unique `{workspace, urlKey}`; `{workspace, status, name}`, `{workspace, category}`, `{workspace, tags}`                    |
| `GroupShare`    | Text and optional link to post                                                       | `{workspace, _id:-1}`                                                                                                      |
| `SharingTask`   | One share in one group: status, assignee, due date, who finished it, post link, note | unique `{share, group}`; `{workspace, status, _id:-1}`, `{workspace, assignee, status}`, `{group, status, completedAt:-1}` |

## Code and tests

- Shared: `packages/shared/src/groups.js` (limits, enums, link parsing, schemas).
- API: `apps/api/src/models/{GroupCategory,FacebookGroup,GroupShare,SharingTask}.js`,
  `apps/api/src/modules/groups/` (directory and sharing services, routes).
- Web: `apps/web/src/features/groups/`.
- Tests: `apps/api/test/groups.test.js`, `packages/shared/test/groups.test.js`,
  `apps/web/src/features/groups/groups.test.jsx`.

## Not included

- Shares do not import drafts from the composer: their text is written on the Shares tab.
- SocialHub cannot confirm that a post really appeared in a group. "Shared" is what the person
  reported, optionally with the post's link.
- No bulk import of groups yet.
