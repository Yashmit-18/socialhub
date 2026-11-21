# Account organisation

Tools for keeping many Facebook Pages and Instagram accounts manageable inside one workspace,
added on 2026-11-21. They are SocialHub data only: nothing on this page reads from or writes
to Meta, so all of it works today and none of it depends on the Meta verification that
Phases 2–5 are still waiting for.

| Feature                                                                                            | Who can use it                                                                                                        | Where                                                                                                         |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **All accounts tab** – Facebook Pages and Instagram accounts in one table, with every bulk action  | Everyone (actions follow the role)                                                                                    | Social accounts → All accounts (`/w/:slug/accounts/all`)                                                      |
| **Labels** – coloured tags such as a client, brand or region                                       | Read: everyone. Create, rename, recolour, delete and apply: members with `social_connections:manage` (owners, admins) | Filter bar, bulk bar ("Labels"), row menu ("Labels…"), account detail ("Edit labels"), Overview "Labels" card |
| **Stars** – each person's own important accounts                                                   | Everyone, for accounts they can see. Private to the person                                                            | ☆ next to an account's name, "Starred" filter, Overview "Your starred accounts" card                          |
| **Team notes** – contacts, approval rules, posting guidelines                                      | Read: everyone who can see the account. Edit: owners, admins                                                          | Account detail → "Team notes"; a note icon marks accounts that have notes                                     |
| **Sort by followers**                                                                              | Everyone                                                                                                              | Sort menu ("Most / Fewest followers") or the Followers column header                                          |
| **CSV export** of the current filters (all pages, not only the one on screen)                      | Everyone, for the accounts they can see                                                                               | "Export CSV" in the filter bar (workspace and all-workspaces views)                                           |
| **Open on Facebook / Instagram** and **Copy Meta ID**                                              | Everyone                                                                                                              | Row menu and account detail header                                                                            |
| **Composer quick select** – add every starred account, or every account with a label, in one click | Everyone who can post, for the accounts they can use                                                                  | Create post → Post to → "Quick select"; account rows show their labels and star, and search matches labels    |

## Rules

- **Access.** Every read and write starts from `accessibleAccountFilter(membership)`. An
  account the member may not use is answered with 404, exactly like the other account routes.
  Label counts, facets, stars and the CSV only ever cover the accounts the member can see.
- **Labels** are unique per workspace regardless of case (409 on a duplicate). Limits: 100
  labels per workspace, 20 labels per account, names up to 32 characters. Colours are a fixed
  list of names (`LABEL_COLORS`); each client maps them to its own palette. Deleting a label
  takes it off every account. A bulk change is checked in full before anything is written:
  an unknown label is 422, an unknown or inaccessible account is 404, and going over 20 labels
  on any account is 422 with nothing written.
- **Stars** are stored per person (`AccountStar`). They are removed when the account is removed
  from the workspace or the workspace is deleted.
- **Notes** are at most 2,000 characters. An empty string clears them. The activity log records
  that notes changed and their length, never the text.
- **Followers.** Unknown follower counts (null) sort last in both directions; they are never
  treated as 0. The CSV leaves them empty.
- **CSV.** Same filters and validation as the listing. Cells that a spreadsheet would run as a
  formula (starting with `=`, `+`, `-`, `@`, tab or carriage return) get a leading apostrophe.
  The file has a UTF-8 byte order mark, is sent with `Cache-Control: no-store` and never
  contains token fields.

## API

All workspace routes are under `/api/v1/workspaces/:workspaceId`.

| Method and path                           | Permission                  | Body / query                                        | Answer                                                  |
| ----------------------------------------- | --------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `GET /account-labels`                     | `social_accounts:read`      | –                                                   | `{ items: [{ id, name, color, accountCount }], limit }` |
| `POST /account-labels`                    | `social_connections:manage` | `{ name, color? }`                                  | 201 `{ label }`; 409 duplicate or limit                 |
| `PATCH /account-labels/:labelId`          | `social_connections:manage` | `{ name?, color? }` (at least one)                  | `{ label }`; 404, 409                                   |
| `DELETE /account-labels/:labelId`         | `social_connections:manage` | –                                                   | `{ removedFromAccounts }`                               |
| `POST /social-accounts/labels`            | `social_connections:manage` | `{ accountIds, add: [labelId], remove: [labelId] }` | `{ updated, accounts: [{ id, labels }] }`               |
| `PUT /social-accounts/:accountId/star`    | `social_accounts:read`      | –                                                   | `{ starred: true }`                                     |
| `DELETE /social-accounts/:accountId/star` | `social_accounts:read`      | –                                                   | `{ starred: false }`                                    |
| `PUT /social-accounts/:accountId/notes`   | `social_connections:manage` | `{ notes }`                                         | `{ notes: { text, updatedAt, updatedBy } }`             |
| `GET /social-accounts/export`             | `social_accounts:read`      | listing query                                       | `text/csv` download                                     |
| `GET /api/v1/social-accounts/export`      | signed in                   | cross-workspace listing query                       | `text/csv` with a Workspace column                      |

Changes to existing responses:

- Every account item has `labels: [{ id, name, color }]`, `starred` (for the requesting person)
  and `hasNotes`. The notes text is only in the detail (`notes` block).
- The listing accepts `label=<id>`, `starred=true|false` and `sort=-followers|followers`, and
  its `facets` add `labels: { [labelId]: count }` and `starred: count`. Search also matches
  label names.
- New activity actions: `account_label.created`, `account_label.updated`,
  `account_label.deleted`, `social_account.labels_updated`, `social_account.notes_updated`.

## Code

- Shared: `packages/shared/src/accountLabels.js` (limits, colours, schemas); query filters in
  `schemas.js`; sorts and activity actions in `enums.js`.
- API: `models/AccountLabel.js`, `models/AccountStar.js`, new fields on `SocialAccount`
  (`labels`, `notes`, `notesUpdatedAt`, `notesUpdatedBy`);
  `modules/socialAccounts/accountOrganization.service.js`, `accountExport.js`, routes in
  `socialAccount.routes.js`; filters, facets and follower sort in
  `accountManagement.service.js`.
- Web: `components/accounts/AccountLabels.jsx`, `ApplyLabelsDialog.jsx`,
  `ManageLabelsDialog.jsx`, `AccountNotesCard.jsx`, `ExportAccountsButton.jsx`,
  `OrganizationCards.jsx`; `pages/workspace/accounts/AllAccountsPage.jsx`;
  `lib/accountOrganization.js`.

## Tests

`apps/api/test/accounts.organization.test.js` (22),
`packages/shared/test/accountLabels.test.js` (5),
`apps/web/src/pages/workspace/accounts/AccountOrganization.test.jsx` (13).

Composer: `apps/web/src/features/composer/model/accounts.test.js` and
`components/accounts/accounts.test.jsx` (quick select, label search, labels on rows).

## Possible next steps (not built)

- Saved filter views.
