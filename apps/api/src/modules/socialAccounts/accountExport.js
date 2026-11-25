/**
 * CSV export of the destination listing. Rows are the views the listing itself would return
 * (same access rules and filters), so the file never contains anything the member could not
 * see on screen, and never token material: views are built without token fields.
 */
import { SOCIAL_PLATFORMS, SOCIAL_PROVIDERS } from '@socialhub/shared';

const PLATFORM = {
  [SOCIAL_PLATFORMS.FACEBOOK_PAGE]: 'Facebook Page',
  [SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT]: 'Instagram account',
};
const PROVIDER = {
  [SOCIAL_PROVIDERS.FACEBOOK_LOGIN]: 'Facebook Login',
  [SOCIAL_PROVIDERS.INSTAGRAM_LOGIN]: 'Instagram Login',
  [SOCIAL_PROVIDERS.INSTAGRAM_UNIFIED_LOGIN]: 'Instagram Unified Login',
};
const titleCase = (value) =>
  typeof value === 'string' && value
    ? value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
    : '';
const isoOrEmpty = (value) => (value ? new Date(value).toISOString() : '');

/**
 * One CSV cell. Values a spreadsheet would run as a formula (starting with =, +, -, @, a tab
 * or a carriage return) get a leading apostrophe; quotes, commas and line breaks are quoted.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const COLUMNS = [
  ['Name', (a) => a.name],
  ['Platform', (a) => PLATFORM[a.platform] ?? a.platform],
  ['Username', (a) => (a.username ? `@${a.username}` : '')],
  ['Meta ID', (a) => a.externalId],
  ['Category', (a) => a.category ?? ''],
  ['Instagram account type', (a) => titleCase(a.instagramAccountType)],
  ['Labels', (a) => (a.labels ?? []).map((l) => l.name).join('; ')],
  ['Starred by me', (a) => (a.starred ? 'Yes' : 'No')],
  // Unknown counts stay empty: unknown is not 0.
  ['Followers', (a) => (typeof a.followersCount === 'number' ? a.followersCount : '')],
  ['Followers as of', (a) => isoOrEmpty(a.followersCountUpdatedAt)],
  ['Connection status', (a) => titleCase(a.health?.connectionStatus)],
  ['Publishing readiness', (a) => titleCase(a.health?.readiness)],
  ['Needs attention', (a) => (a.health?.needsAttention ? 'Yes' : 'No')],
  ['Attention details', (a) => (a.health?.attention ?? []).map((i) => i.message).join('; ')],
  ['Login', (a) => a.connection?.displayName ?? (a.connection ? 'Unnamed login' : 'Login removed')],
  ['Login type', (a) => PROVIDER[a.connection?.provider] ?? ''],
  ['Linked Facebook Page', (a) => a.linkedPage?.name ?? a.linkedPage?.externalId ?? ''],
  ['Has team notes', (a) => (a.hasNotes ? 'Yes' : 'No')],
  ['Last synced', (a) => isoOrEmpty(a.lastSyncedAt)],
  ['Added', (a) => isoOrEmpty(a.createdAt)],
];

/** The CSV document (with a UTF-8 byte order mark so spreadsheet apps read names correctly). */
export function accountsCsv(items, { crossWorkspace = false } = {}) {
  const columns = crossWorkspace
    ? [...COLUMNS.slice(0, 1), ['Workspace', (a) => a.workspace?.name ?? ''], ...COLUMNS.slice(1)]
    : COLUMNS;
  const lines = [columns.map(([header]) => csvCell(header)).join(',')];
  for (const item of items) lines.push(columns.map(([, pick]) => csvCell(pick(item))).join(','));
  const BOM = String.fromCharCode(0xfeff);
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** A safe download name such as `socialhub-accounts-acme-2026-11-21.csv`. */
export function exportFileName(slug, now = new Date()) {
  const safe = String(slug ?? 'all')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `socialhub-accounts-${safe || 'all'}-${now.toISOString().slice(0, 10)}.csv`;
}
