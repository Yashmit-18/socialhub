import { describe, expect, it } from 'vitest';
import { describeActivity } from './activity.js';
import { slugPreview, timeAgo } from './utils.js';

describe('describeActivity', () => {
  it('renders role changes with labels', () => {
    const d = describeActivity({
      action: 'member.role_changed',
      actorName: 'Olivia',
      target: { label: 'Eddie' },
      metadata: { from: 'EDITOR', to: 'ADMIN' },
    });
    expect(`${d.actor} ${d.text}`).toBe("Olivia changed Eddie's role from Editor to Admin");
  });

  it('summarises account access changes', () => {
    const selected = describeActivity({
      action: 'member.account_access_updated',
      actorName: 'A',
      target: { label: 'B' },
      metadata: { mode: 'SELECTED', accountCount: 1 },
    });
    const all = describeActivity({
      action: 'member.account_access_updated',
      actorName: 'A',
      target: { label: 'B' },
      metadata: { mode: 'ALL', accountCount: 0 },
    });
    expect(selected.text).toBe("set B's account access to 1 selected account");
    expect(all.text).toBe("set B's account access to all accounts");
  });

  it('lists changed workspace fields', () => {
    const d = describeActivity({
      action: 'workspace.updated',
      actorName: 'A',
      metadata: { after: { name: 'X', timezone: 'UTC' } },
    });
    expect(d.text).toBe('updated the workspace name, time zone');
  });

  it('explains a post SocialHub did not send because its author lost permission', () => {
    const d = describeActivity({
      action: 'publish_destination.blocked',
      target: { type: 'publish_job', label: 'Acme Store' },
      metadata: { reason: 'NO_ACCOUNT_ACCESS', simulated: true },
    });
    expect(d.actor).toBe('SocialHub');
    expect(d.tone).toBe('danger');
    expect(d.text).toBe(
      'did not send a simulated post to Acme Store: the person who scheduled it may no longer use this account',
    );
  });

  it('falls back gracefully for unknown actions', () => {
    expect(describeActivity({ action: 'future.thing' }).text).toBe('future.thing');
  });
});

describe('utils', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo('2026-01-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-01-01T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2026-01-08T12:00:00Z', now)).toBe('next week');
  });

  it('previews slugs like the API', () => {
    expect(slugPreview('  Café Société  ')).toBe('cafe-societe');
  });
});
