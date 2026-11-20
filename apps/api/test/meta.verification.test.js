import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SocialAccount, SocialConnection } from '../src/models/index.js';
import { verifyMetaIntegration } from '../src/modules/meta/metaVerification.service.js';
import { FakeMeta } from './fakeMeta.js';
import { as, createWorkspace, registerUser } from './helpers.js';
import { connectFacebook, insta, page, selectAccounts } from './metaHelpers.js';

let fake;
beforeEach(() => {
  fake = new FakeMeta().install();
});
afterEach(() => fake.uninstall());

const statusOf = (report) => Object.fromEntries(report.results.map((r) => [r.item, r.status]));

/** Two identities in one workspace, several Pages, a Page-linked Instagram account. */
async function realisticWorkspace() {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token, { name: 'Acme Social' });
  fake.addFacebookUser({
    id: '100',
    name: 'Alice',
    pages: [
      { id: '5001', name: 'Acme Store', instagram: { id: '17841400000000010', username: 'acme' } },
      { id: '5002', name: 'Acme Labs', tasks: ['ANALYZE', 'MODERATE'] },
    ],
  });
  fake.addFacebookUser({ id: '200', name: 'Bob', pages: [{ id: '6001', name: 'Bob Bakery' }] });
  const a = await connectFacebook(fake, owner.token, workspace.id, '100');
  const b = await connectFacebook(fake, owner.token, workspace.id, '200');
  await selectAccounts(owner.token, workspace.id, a.connectionId, [
    page('5001'),
    page('5002'),
    insta('17841400000000010'),
  ]);
  await selectAccounts(owner.token, workspace.id, b.connectionId, [page('6001')]);
  return { owner, workspace, a: a.connectionId, b: b.connectionId };
}

describe('Meta integration verification (read-only)', () => {
  it('reports PENDING, not PASS, before any real connection exists', async () => {
    const report = await verifyMetaIntegration();
    const s = statusOf(report);
    expect(s[1]).toBe('PASS');
    // The test server's public URL is plain http, which Meta rejects.
    expect(s[3]).toBe('FAIL');
    for (const item of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) expect(s[item]).toBe('PENDING');
  });

  it('passes only the items the stored and live evidence supports', async () => {
    const { owner, workspace, a } = await realisticWorkspace();
    const beforeReport = await verifyMetaIntegration();
    const before = statusOf(beforeReport);
    // Without --live, Meta has not confirmed the tokens, so OAuth stays PENDING.
    expect(before[4]).toBe('PENDING');
    expect(before[12]).toBe('PENDING'); // nothing disconnected yet
    expect(before[13]).toBe('PENDING'); // no log supplied
    const createContent = beforeReport.results.find((r) => r.item === 9).evidence.join('\n');
    expect(createContent).toMatch(
      /"Acme Labs": tasks \[ANALYZE, MODERATE\] → lacks CREATE_CONTENT; publishing readiness RESTRICTED/,
    );
    expect(createContent).toMatch(
      /"Acme Store": .* has CREATE_CONTENT; publishing readiness READY/,
    );

    await as(owner.token).post(
      `/api/v1/workspaces/${workspace.id}/social-connections/${a}/disconnect`,
    );
    const report = await verifyMetaIntegration({
      live: true,
      logs: [
        {
          name: 'api.log',
          text: 'GET /api/v1/oauth/facebook/callback?code=[redacted]&state=[redacted] 302',
        },
      ],
    });
    const s = statusOf(report);
    for (const item of [4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15])
      expect([item, s[item]]).toEqual([item, 'PASS']);
    // A pure read: nothing changed.
    expect((await SocialConnection.findById(a)).status).toBe('DISCONNECTED');
    // After disconnecting Alice, her Pages are no longer usable while Bob's stay ready.
    const afterEvidence = report.results.find((r) => r.item === 9).evidence.join('\n');
    expect(afterEvidence).toMatch(/"Acme Store": .* UNAVAILABLE/);
    expect(afterEvidence).toMatch(/"Bob Bakery": .* READY/);
    expect(JSON.stringify(report)).not.toMatch(/pagetoken_|fb_long_/);
  });

  it('fails the leak check when a real token appears in a log', async () => {
    await realisticWorkspace();
    const leaked = fake.pageToken('100', '5001');
    const report = await verifyMetaIntegration({
      logs: [{ name: 'api.log', text: `line one\nresponse body ${leaked}\n` }],
    });
    const item = report.results.find((r) => r.item === 13);
    expect(item.status).toBe('FAIL');
    expect(item.evidence.join('\n')).toMatch(/a stored token on line\(s\) 2/);
    // The report itself never repeats the token.
    expect(JSON.stringify(report)).not.toContain(leaked);
  });

  it('fails on token-shaped strings and unredacted OAuth codes in logs', async () => {
    await realisticWorkspace();
    const report = await verifyMetaIntegration({
      logs: [
        {
          name: 'proxy.log',
          text: 'GET /api/v1/oauth/facebook/callback?code=AQBx123&state=abc\nEAAGm0PX4ZCpsBAOabcdefghijklmnopqrstuvwxyz',
        },
      ],
    });
    const evidence = report.results.find((r) => r.item === 13).evidence.join('\n');
    expect(report.results.find((r) => r.item === 13).status).toBe('FAIL');
    expect(evidence).toMatch(/unredacted OAuth code/);
    expect(evidence).toMatch(/Facebook access token/);
  });

  it('fails association and isolation checks when data is inconsistent', async () => {
    const { owner } = await realisticWorkspace();
    const other = await createWorkspace(owner.token, { name: 'Other Brand' });
    fake.addFacebookUser({ id: '300', pages: [] });
    const foreign = await connectFacebook(fake, owner.token, other.workspace.id, '300');
    // Simulate a corrupted link: a Page pointing at another workspace's connection.
    await SocialAccount.updateOne({ externalId: '6001' }, { connection: foreign.connectionId });
    const s = statusOf(await verifyMetaIntegration());
    expect(s[8]).toBe('FAIL');
    expect(s[14]).toBe('FAIL');
  });

  it('confirms revocation handling once Meta has revoked a token', async () => {
    const { owner, workspace, b } = await realisticWorkspace();
    fake.setTokenState('200', 'revoked');
    await as(owner.token).post(`/api/v1/workspaces/${workspace.id}/social-connections/${b}/sync`);
    const report = await verifyMetaIntegration();
    expect(statusOf(report)[11]).toBe('PASS');
    expect(report.results.find((r) => r.item === 11).evidence.join('\n')).toMatch(/REVOKED/);
  });

  it('reports a live Meta rejection as a failure of the OAuth item', async () => {
    await realisticWorkspace();
    fake.setTokenState('100', 'revoked');
    fake.setTokenState('200', 'revoked');
    const s = statusOf(await verifyMetaIntegration({ live: true }));
    expect(s[4]).toBe('FAIL');
  });
});
