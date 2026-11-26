/**
 * Words the Analytics screen shows for states (sync, missing insights). Kept here so the
 * section components stay markup only.
 */
import { ANALYTICS_SOURCES } from '@socialhub/shared';
import { timeAgo } from '../../lib/utils.js';

/** An account's insights sync: its words and the state that colours its dot. */
export function syncState(sync) {
  if (!sync?.last) return { text: 'Never synced', state: 'idle' };
  if (sync.active) return { text: 'Syncing…', state: 'active' };
  if (sync.last.status === 'FAILED') {
    return {
      text: `Last sync failed${sync.last.error ? `: ${sync.last.error.message}` : ''}`,
      state: 'failed',
    };
  }
  const at = sync.lastSuccess?.finishedAt;
  return at
    ? { text: `Synced ${timeAgo(at)}`, state: 'done' }
    : { text: 'Never synced', state: 'idle' };
}

/**
 * Why there are no insights for this range, said once, where the insights would be.
 * `demoView`: the person chose "Demo data (made up)"; `serverSource`: where this server reads
 * insights from (META, SIMULATED, or null when reading them is switched off).
 */
export function missingInsightsSentence({ demoView, serverSource }) {
  if (demoView) {
    return 'No demo data has been made for these accounts yet. Use "Make demo insights" while the server runs in demo mode.';
  }
  if (serverSource === ANALYTICS_SOURCES.SIMULATED) {
    return 'This server makes demo insights only and never reads them from Meta. To see them, choose "Demo data (made up)" under Insights.';
  }
  if (serverSource === ANALYTICS_SOURCES.META) {
    return 'Reach, views and engagement come only from Meta, and none has been read yet for this range: sync the accounts to read them.';
  }
  return 'Reach, views and engagement come only from Meta: reading insights from Meta is not switched on for this server yet, so they show as unavailable.';
}
