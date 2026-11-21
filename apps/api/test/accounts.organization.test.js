/**
 * API integration tests for account organisation: workspace labels (CRUD, bulk labelling,
 * filters, facets, search), per-person stars, team notes, sorting by followers and the CSV
 * export of the account listing.
 *
 * Meta is not involved: destinations are fixture documents inserted with seedSocialAccounts().
 * A FakeMeta transport is installed only as a guard and every test asserts that no request was
 * made to it — labels, stars and notes are SocialHub data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_LABEL_LIMITS } from '@socialhub/shared';
import { csvCell } from '../src/modules/socialAccounts/accountExport.js';
import { AccountLabel, AccountStar, ActivityLog, SocialAccount } from '../src/models/index.js';
import { FakeMeta } from './fakeMeta.js';
import { as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => {
  fake.uninstall();
  expect(fake.calls).toEqual([]);
});

const wsUrl = (ws) => `/api/v1/workspaces/${ws.id}`;
const labelsUrl = (ws) => `${wsUrl(ws)}/account-labels`;
const accountsUrl = (ws) => `${wsUrl(ws)}/social-accounts`;
const accountUrl = (ws, accountId) => `${accountsUrl(ws)}/${accountId}`;
const TOKEN_MATERIAL = /accessToken|access_token|ciphertext|authTag|keyVersion/;

function list(token, ws, params = {}) {
  const query = new URLSearchParams(params).toString();
  return as(token).get(`${accountsUrl(ws)}${query ? `?${query}` : ''}`);
}
const names = (res) => res.body.items.map((item) => item.name);
const createLabel = (token, ws, body) => as(token).post(labelsUrl(ws)).send(body);
const assign = (token, ws, body) =>
  as(token)
    .post(`${accountsUrl(ws)}/labels`)
    .send(body);

async function seeded() {
  const team = await seedTeam();
  const { accounts } = await seedSocialAccounts(team.workspace.id, team.owner.user.id, {
    pages: 3,
    instagram: 1,
  });
  const ids = accounts.map((a) => String(a._id));
  return { team, ws: team.workspace, ids };
}

async function grant(team, accountId, member) {
  const res = await as(team.owner.token)
    .patch(`${accountUrl(team.workspace, accountId)}/access`)
    .send({ grant: [member.membershipId] });
  expect(res.status).toBe(200);
}

/* ------------------------------------------------------------------- labels */

describe('workspace labels', () => {
  it('creates, lists, renames, recolours and deletes labels, with activity entries', async () => {
    const { team, ws } = await seeded();
    const created = await createLabel(team.owner.token, ws, { name: '  Client A ' });
    expect(created.status).toBe(201);
    expect(created.body.label).toEqual({
      id: expect.any(String),
      name: 'Client A',
      color: 'slate',
      accountCount: 0,
    });
    const labelId = created.body.label.id;
    await createLabel(team.admin.token, ws, { name: 'Bakery', color: 'amber' });

    const listed = await as(team.viewer.token).get(labelsUrl(ws));
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((l) => [l.name, l.color])).toEqual([
      ['Bakery', 'amber'],
      ['Client A', 'slate'],
    ]);
    expect(listed.body.limit).toBe(ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX);

    const renamed = await as(team.owner.token)
      .patch(`${labelsUrl(ws)}/${labelId}`)
      .send({ name: 'Client Alpha', color: 'violet' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.label).toMatchObject({ name: 'Client Alpha', color: 'violet' });

    const removed = await as(team.owner.token).delete(`${labelsUrl(ws)}/${labelId}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ removedFromAccounts: 0 });
    expect(await AccountLabel.exists({ _id: labelId })).toBeNull();

    const actions = (await ActivityLog.find({ workspace: ws.id, 'target.type': 'account_label' }))
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual([
      'account_label.created',
      'account_label.created',
      'account_label.deleted',
      'account_label.updated',
    ]);
  });

  it('rejects duplicate names regardless of case, invalid colours and empty changes', async () => {
    const { team, ws } = await seeded();
    expect((await createLabel(team.owner.token, ws, { name: 'Retail' })).status).toBe(201);
    const duplicate = await createLabel(team.owner.token, ws, { name: 'RETAIL' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details.fields.name).toMatch(/already exists/);

    const other = (await createLabel(team.owner.token, ws, { name: 'Food' })).body.label;
    const clash = await as(team.owner.token)
      .patch(`${labelsUrl(ws)}/${other.id}`)
      .send({ name: 'retail' });
    expect(clash.status).toBe(409);

    expect((await createLabel(team.owner.token, ws, { name: 'X', color: 'gold' })).status).toBe(
      422,
    );
    expect((await createLabel(team.owner.token, ws, { name: '' })).status).toBe(422);
    expect((await createLabel(team.owner.token, ws, { name: 'x'.repeat(33) })).status).toBe(422);
    expect(
      (
        await as(team.owner.token)
          .patch(`${labelsUrl(ws)}/${other.id}`)
          .send({})
      ).status,
    ).toBe(422);
  });

  it('caps the number of labels per workspace', async () => {
    const { team, ws } = await seeded();
    await AccountLabel.insertMany(
      Array.from({ length: ACCOUNT_LABEL_LIMITS.PER_WORKSPACE_MAX }, (_, i) => ({
        workspace: ws.id,
        name: `Label ${i}`,
        nameKey: `label ${i}`,
        createdBy: team.owner.user.id,
      })),
    );
    const res = await createLabel(team.owner.token, ws, { name: 'One too many' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/up to 100 labels/);
  });

  it('lets only members who manage logins change labels; everyone can read them', async () => {
    const { team, ws } = await seeded();
    const label = (await createLabel(team.owner.token, ws, { name: 'VIP' })).body.label;
    for (const member of [team.editor, team.viewer]) {
      expect((await createLabel(member.token, ws, { name: 'Nope' })).status).toBe(403);
      expect(
        (
          await as(member.token)
            .patch(`${labelsUrl(ws)}/${label.id}`)
            .send({ color: 'red' })
        ).status,
      ).toBe(403);
      expect((await as(member.token).delete(`${labelsUrl(ws)}/${label.id}`)).status).toBe(403);
      expect((await as(member.token).get(labelsUrl(ws))).status).toBe(200);
    }
  });

  it('keeps labels inside their workspace', async () => {
    const { team, ws } = await seeded();
    const stranger = await registerUser({ name: 'Stranger' });
    const { workspace: otherWs } = await createWorkspace(stranger.token, { name: 'Other Co' });
    const foreign = (await createLabel(stranger.token, otherWs, { name: 'Foreign' })).body.label;

    expect(
      (
        await as(team.owner.token)
          .patch(`${labelsUrl(ws)}/${foreign.id}`)
          .send({ color: 'red' })
      ).status,
    ).toBe(404);
    expect((await as(team.owner.token).delete(`${labelsUrl(ws)}/${foreign.id}`)).status).toBe(404);
    expect((await as(team.owner.token).get(labelsUrl(ws))).body.items).toEqual([]);
    expect((await as(stranger.token).get(labelsUrl(ws))).status).toBe(404);
  });
});

/* --------------------------------------------------------- labelling accounts */

describe('labelling destinations', () => {
  it('adds and removes labels in bulk and shows them on the listing, filters, facets and search', async () => {
    const { team, ws, ids } = await seeded();
    const alpha = (await createLabel(team.owner.token, ws, { name: 'Client A', color: 'sky' })).body
      .label;
    const north = (await createLabel(team.owner.token, ws, { name: 'North' })).body.label;

    const added = await assign(team.owner.token, ws, {
      accountIds: [ids[0], ids[1]],
      add: [alpha.id, north.id],
    });
    expect(added.status).toBe(200);
    expect(added.body.updated).toBe(2);
    expect(added.body.accounts.find((a) => a.id === ids[0]).labels).toEqual([
      { id: alpha.id, name: 'Client A', color: 'sky' },
      { id: north.id, name: 'North', color: 'slate' },
    ]);

    const all = await list(team.owner.token, ws);
    const page0 = all.body.items.find((a) => a.id === ids[0]);
    expect(page0.labels.map((l) => l.name)).toEqual(['Client A', 'North']);
    expect(all.body.facets.labels).toEqual({ [alpha.id]: 2, [north.id]: 2 });

    expect(names(await list(team.owner.token, ws, { label: alpha.id }))).toEqual([
      'Page 0',
      'Page 1',
    ]);
    expect(names(await list(team.owner.token, ws, { q: 'north' }))).toEqual(['Page 0', 'Page 1']);

    // Removing one label from one account; repeating a change is a no-op.
    const removed = await assign(team.owner.token, ws, {
      accountIds: [ids[1]],
      remove: [north.id],
    });
    expect(removed.body.updated).toBe(1);
    const again = await assign(team.owner.token, ws, { accountIds: [ids[1]], remove: [north.id] });
    expect(again.body.updated).toBe(0);
    expect(names(await list(team.owner.token, ws, { label: north.id }))).toEqual(['Page 0']);

    const counts = await as(team.owner.token).get(labelsUrl(ws));
    expect(Object.fromEntries(counts.body.items.map((l) => [l.name, l.accountCount]))).toEqual({
      'Client A': 2,
      North: 1,
    });

    const logs = await ActivityLog.find({
      workspace: ws.id,
      action: 'social_account.labels_updated',
    }).sort({ _id: 1 });
    expect(logs.map((l) => l.metadata)).toEqual([
      { added: ['Client A', 'North'], removed: [] },
      { added: ['Client A', 'North'], removed: [] },
      { added: [], removed: ['North'] },
    ]);
  });

  it('takes a deleted label off every destination', async () => {
    const { team, ws, ids } = await seeded();
    const label = (await createLabel(team.owner.token, ws, { name: 'Temp' })).body.label;
    await assign(team.owner.token, ws, { accountIds: ids, add: [label.id] });
    const res = await as(team.owner.token).delete(`${labelsUrl(ws)}/${label.id}`);
    expect(res.body).toEqual({ removedFromAccounts: ids.length });
    const listed = await list(team.owner.token, ws);
    expect(listed.body.items.every((a) => a.labels.length === 0)).toBe(true);
    expect(listed.body.facets.labels).toEqual({});
  });

  it('validates the request and writes nothing when any part is invalid', async () => {
    const { team, ws, ids } = await seeded();
    const label = (await createLabel(team.owner.token, ws, { name: 'Ok' })).body.label;
    const stranger = await registerUser({ name: 'Stranger' });
    const { workspace: otherWs } = await createWorkspace(stranger.token, { name: 'Other Co' });
    const foreign = (await createLabel(stranger.token, otherWs, { name: 'Foreign' })).body.label;
    const { accounts: foreignAccounts } = await seedSocialAccounts(otherWs.id, stranger.user.id, {
      pages: 1,
      instagram: 0,
      externalUserId: 'other-user',
    });

    const both = await assign(team.owner.token, ws, {
      accountIds: [ids[0]],
      add: [label.id],
      remove: [label.id],
    });
    expect(both.status).toBe(422);
    expect((await assign(team.owner.token, ws, { accountIds: [ids[0]] })).status).toBe(422);
    expect((await assign(team.owner.token, ws, { accountIds: [], add: [label.id] })).status).toBe(
      422,
    );

    const foreignLabel = await assign(team.owner.token, ws, {
      accountIds: [ids[0]],
      add: [label.id, foreign.id],
    });
    expect(foreignLabel.status).toBe(422);
    expect(foreignLabel.body.error.details.fields.labels).toMatch(/no longer exist/);

    const foreignAccount = await assign(team.owner.token, ws, {
      accountIds: [ids[0], String(foreignAccounts[0]._id)],
      add: [label.id],
    });
    expect(foreignAccount.status).toBe(404);

    expect(await SocialAccount.countDocuments({ labels: { $exists: true, $ne: [] } })).toBe(0);
  });

  it('refuses to put more than the per-account limit of labels on a destination', async () => {
    const { team, ws, ids } = await seeded();
    const docs = await AccountLabel.insertMany(
      Array.from({ length: ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX + 1 }, (_, i) => ({
        workspace: ws.id,
        name: `L${i}`,
        nameKey: `l${i}`,
        createdBy: team.owner.user.id,
      })),
    );
    const labelIds = docs.map((d) => String(d._id));
    const first = await assign(team.owner.token, ws, {
      accountIds: [ids[0]],
      add: labelIds.slice(0, ACCOUNT_LABEL_LIMITS.PER_ACCOUNT_MAX),
    });
    expect(first.status).toBe(200);
    const over = await assign(team.owner.token, ws, {
      accountIds: [ids[0], ids[1]],
      add: [labelIds.at(-1)],
    });
    expect(over.status).toBe(422);
    expect(over.body.error.details.fields.add).toMatch(/more than 20 labels/);
    // Nothing was written, not even on the account that had room.
    expect((await SocialAccount.findById(ids[1])).labels ?? []).toEqual([]);
  });

  it('lets only members who manage logins label destinations', async () => {
    const { team, ws, ids } = await seeded();
    const label = (await createLabel(team.owner.token, ws, { name: 'Ok' })).body.label;
    await grant(team, ids[0], team.editor);
    for (const member of [team.editor, team.viewer]) {
      expect(
        (await assign(member.token, ws, { accountIds: [ids[0]], add: [label.id] })).status,
      ).toBe(403);
    }
  });

  it('counts labels only over the destinations a member can use', async () => {
    const { team, ws, ids } = await seeded();
    const label = (await createLabel(team.owner.token, ws, { name: 'Shared' })).body.label;
    await assign(team.owner.token, ws, { accountIds: ids, add: [label.id] });
    await grant(team, ids[2], team.editor);

    const editorLabels = await as(team.editor.token).get(labelsUrl(ws));
    expect(editorLabels.body.items[0].accountCount).toBe(1);
    const editorList = await list(team.editor.token, ws, { label: label.id });
    expect(names(editorList)).toEqual(['Page 2']);
    expect(editorList.body.facets.labels).toEqual({ [label.id]: 1 });
  });
});

/* -------------------------------------------------------------------- stars */

describe('starred destinations', () => {
  it('keeps stars personal: each person sees and filters only their own', async () => {
    const { team, ws, ids } = await seeded();
    await grant(team, ids[1], team.editor);

    const starred = await as(team.editor.token).put(`${accountUrl(ws, ids[1])}/star`);
    expect(starred.status).toBe(200);
    expect(starred.body).toEqual({ starred: true });
    // Starring twice is harmless.
    expect((await as(team.editor.token).put(`${accountUrl(ws, ids[1])}/star`)).status).toBe(200);
    expect(await AccountStar.countDocuments({ socialAccount: ids[1] })).toBe(1);

    await as(team.owner.token).put(`${accountUrl(ws, ids[0])}/star`);

    const editorList = await list(team.editor.token, ws);
    expect(editorList.body.items.map((a) => [a.name, a.starred])).toEqual([['Page 1', true]]);
    expect(editorList.body.facets.starred).toBe(1);

    const ownerStarred = await list(team.owner.token, ws, { starred: 'true' });
    expect(names(ownerStarred)).toEqual(['Page 0']);
    expect(names(await list(team.owner.token, ws, { starred: 'false' }))).toEqual([
      'Instagram 0',
      'Page 1',
      'Page 2',
    ]);

    const detail = await as(team.editor.token).get(accountUrl(ws, ids[1]));
    expect(detail.body.account.starred).toBe(true);

    const unstarred = await as(team.editor.token).delete(`${accountUrl(ws, ids[1])}/star`);
    expect(unstarred.body).toEqual({ starred: false });
    expect(names(await list(team.editor.token, ws, { starred: 'true' }))).toEqual([]);
  });

  it('answers 404 for a destination the person cannot use', async () => {
    const { team, ws, ids } = await seeded();
    expect((await as(team.viewer.token).put(`${accountUrl(ws, ids[0])}/star`)).status).toBe(404);
    expect(await AccountStar.countDocuments({})).toBe(0);
  });

  it('removes stars together with the destination', async () => {
    const { team, ws, ids } = await seeded();
    await as(team.owner.token).put(`${accountUrl(ws, ids[0])}/star`);
    await as(team.admin.token).put(`${accountUrl(ws, ids[0])}/star`);
    expect(await AccountStar.countDocuments({ socialAccount: ids[0] })).toBe(2);
    expect((await as(team.owner.token).delete(accountUrl(ws, ids[0]))).status).toBe(204);
    expect(await AccountStar.countDocuments({ socialAccount: ids[0] })).toBe(0);
  });
});

/* -------------------------------------------------------------------- notes */

describe('team notes', () => {
  it('saves, shows and clears notes; the list only says whether there are any', async () => {
    const { team, ws, ids } = await seeded();
    const saved = await as(team.owner.token)
      .put(`${accountUrl(ws, ids[0])}/notes`)
      .send({ notes: '  Client contact: Dana. Post before 10am.  ' });
    expect(saved.status).toBe(200);
    expect(saved.body.notes).toEqual({
      text: 'Client contact: Dana. Post before 10am.',
      updatedAt: expect.any(String),
      updatedBy: { id: team.owner.user.id, name: 'Olivia Owner' },
    });

    await grant(team, ids[0], team.editor);
    const detail = await as(team.editor.token).get(accountUrl(ws, ids[0]));
    expect(detail.body.notes.text).toBe('Client contact: Dana. Post before 10am.');
    expect(detail.body.account.hasNotes).toBe(true);
    expect(detail.body.account.notes).toBeUndefined();

    const item = (await list(team.owner.token, ws)).body.items.find((a) => a.id === ids[0]);
    expect(item.hasNotes).toBe(true);
    expect(item).not.toHaveProperty('notes');
    expect(item).not.toHaveProperty('notesUpdatedBy');

    const log = await ActivityLog.findOne({ action: 'social_account.notes_updated' });
    expect(log.metadata).toEqual({ cleared: false, length: 39 });
    expect(JSON.stringify(log.toJSON())).not.toMatch(/Dana/);

    const cleared = await as(team.owner.token)
      .put(`${accountUrl(ws, ids[0])}/notes`)
      .send({ notes: '' });
    expect(cleared.body.notes).toEqual({ text: '', updatedAt: null, updatedBy: null });
    expect((await as(team.owner.token).get(accountUrl(ws, ids[0]))).body.account.hasNotes).toBe(
      false,
    );
  });

  it('lets only members who manage logins edit notes, within the length limit', async () => {
    const { team, ws, ids } = await seeded();
    await grant(team, ids[0], team.editor);
    expect(
      (
        await as(team.editor.token)
          .put(`${accountUrl(ws, ids[0])}/notes`)
          .send({ notes: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(team.owner.token)
          .put(`${accountUrl(ws, ids[0])}/notes`)
          .send({ notes: 'x'.repeat(ACCOUNT_LABEL_LIMITS.NOTES_MAX + 1) })
      ).status,
    ).toBe(422);
    expect(
      (
        await as(team.owner.token)
          .put(`${accountUrl(ws, ids[0])}/notes`)
          .send({ text: 'x' })
      ).status,
    ).toBe(422);
  });
});

/* ------------------------------------------------------------ followers sort */

describe('sorting by followers', () => {
  it('orders by the last known count and keeps unknown counts last in both directions', async () => {
    const { team, ws, ids } = await seeded();
    await SocialAccount.updateOne({ _id: ids[0] }, { followersCount: 500 });
    await SocialAccount.updateOne({ _id: ids[1] }, { followersCount: 12_000 });
    await SocialAccount.updateOne({ _id: ids[3] }, { followersCount: 0 });

    expect(names(await list(team.owner.token, ws, { sort: '-followers' }))).toEqual([
      'Page 1',
      'Page 0',
      'Instagram 0',
      'Page 2',
    ]);
    expect(names(await list(team.owner.token, ws, { sort: 'followers' }))).toEqual([
      'Instagram 0',
      'Page 0',
      'Page 1',
      'Page 2',
    ]);
  });
});

/* -------------------------------------------------------------------- export */

const parseCsv = (text) =>
  text
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');

describe('CSV export', () => {
  it('exports every matching destination with the listing filters, as a download', async () => {
    const { team, ws, ids } = await seeded();
    const label = (await createLabel(team.owner.token, ws, { name: 'Client A' })).body.label;
    await assign(team.owner.token, ws, { accountIds: [ids[0], ids[3]], add: [label.id] });
    await SocialAccount.updateOne({ _id: ids[0] }, { followersCount: 1234 });

    const res = await as(team.owner.token).get(
      `${accountsUrl(ws)}/export?label=${label.id}&sort=-followers`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?socialhub-accounts-acme-social-\d{4}-\d{2}-\d{2}\.csv"?$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = parseCsv(res.text);
    expect(lines[0].split(',').slice(0, 9)).toEqual([
      'Name',
      'Platform',
      'Username',
      'Meta ID',
      'Category',
      'Instagram account type',
      'Labels',
      'Starred by me',
      'Followers',
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Page 0,Facebook Page,,fb-user-1-page-0,,,Client A,No,1234,/);
    // Unknown follower count: empty, not 0.
    expect(lines[2]).toMatch(/^Instagram 0,Instagram account,,fb-user-1-ig-0,,,Client A,No,,/);
    expect(res.text).not.toMatch(TOKEN_MATERIAL);
  });

  it('exports only the destinations the member can use', async () => {
    const { team, ws, ids } = await seeded();
    await grant(team, ids[2], team.viewer);
    const res = await as(team.viewer.token).get(`${accountsUrl(ws)}/export`);
    expect(res.status).toBe(200);
    const lines = parseCsv(res.text);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Page 2,/);
  });

  it('neutralises spreadsheet formulas and quotes separators', async () => {
    const { team, ws, ids } = await seeded();
    await SocialAccount.updateOne({ _id: ids[0] }, { name: '=HYPERLINK("http://x","y")' });
    await SocialAccount.updateOne({ _id: ids[1] }, { name: 'Shop, "North"' });
    const res = await as(team.owner.token).get(`${accountsUrl(ws)}/export`);
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(res.text).toContain('"Shop, ""North"""');

    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('exports across workspaces with a Workspace column', async () => {
    const { team, ws } = await seeded();
    const res = await as(team.owner.token).get('/api/v1/social-accounts/export');
    expect(res.status).toBe(200);
    const lines = parseCsv(res.text);
    expect(lines[0].startsWith('Name,Workspace,Platform')).toBe(true);
    expect(lines.slice(1).every((line) => line.includes(`,${ws.name},`))).toBe(true);
    expect(res.headers['content-disposition']).toMatch(/socialhub-accounts-all-workspaces-/);
  });

  it('validates export filters like the listing', async () => {
    const { team, ws } = await seeded();
    expect((await as(team.owner.token).get(`${accountsUrl(ws)}/export?sort=bogus`)).status).toBe(
      422,
    );
    expect((await as(team.owner.token).get(`${accountsUrl(ws)}/export?label=nope`)).status).toBe(
      422,
    );
  });
});
