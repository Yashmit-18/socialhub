import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { SOCIAL_PLATFORMS, SOCIAL_PROVIDERS } from '@socialhub/shared';
import { config } from '../src/config/env.js';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';
import { SocialAccount, SocialConnection } from '../src/models/index.js';
import { canAccessAccount } from '../src/modules/socialAccounts/socialAccount.service.js';

const oid = () => new mongoose.Types.ObjectId();

function connectionDoc(workspace, externalUserId, provider = SOCIAL_PROVIDERS.FACEBOOK_LOGIN) {
  return { workspace, provider, externalUserId, displayName: externalUserId, connectedBy: oid() };
}

function pageDoc(workspace, connection, externalId, platform = SOCIAL_PLATFORMS.FACEBOOK_PAGE) {
  return {
    workspace,
    connection,
    platform,
    externalId,
    name: `Page ${externalId}`,
    connectedBy: oid(),
  };
}

describe('token encryption', () => {
  it('round-trips with AES-256-GCM and a random IV', () => {
    const key = config.tokenEncryptionKey;
    const a = encryptSecret('EAAG-secret', key);
    const b = encryptSecret('EAAG-secret', key);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a, key)).toBe('EAAG-secret');
  });

  it('detects tampering and wrong keys', () => {
    const key = config.tokenEncryptionKey;
    const payload = encryptSecret('EAAG-secret', key);
    const tampered = { ...payload, ciphertext: Buffer.from('xxxxxxxxxxx').toString('base64') };
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(payload, Buffer.alloc(32, 1))).toThrow();
  });
});

describe('SocialConnection (OAuth identities)', () => {
  it('allows many Facebook identities in one workspace', async () => {
    const ws = oid();
    await SocialConnection.create(connectionDoc(ws, 'fb-user-a'));
    await SocialConnection.create(connectionDoc(ws, 'fb-user-b'));
    await SocialConnection.create(connectionDoc(ws, 'ig-user-a', SOCIAL_PROVIDERS.INSTAGRAM_LOGIN));
    expect(await SocialConnection.countDocuments({ workspace: ws })).toBe(3);
  });

  it('allows the same identity in different workspaces but not twice in one', async () => {
    const [ws1, ws2] = [oid(), oid()];
    await SocialConnection.create(connectionDoc(ws1, 'fb-user-a'));
    await SocialConnection.create(connectionDoc(ws2, 'fb-user-a'));
    await expect(SocialConnection.create(connectionDoc(ws1, 'fb-user-a'))).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('encrypts access tokens at rest and hides them by default', async () => {
    const conn = new SocialConnection(connectionDoc(oid(), 'fb-user-a'));
    conn.setAccessToken('EAAG-long-lived-user-token');
    await conn.save();

    const raw = await mongoose.connection.db
      .collection('socialconnections')
      .findOne({ _id: conn._id });
    expect(JSON.stringify(raw)).not.toContain('EAAG-long-lived-user-token');
    expect(raw.accessToken.ciphertext).toEqual(expect.any(String));

    const loaded = await SocialConnection.findById(conn._id);
    expect(loaded.accessToken).toBeUndefined();
    expect(JSON.stringify(loaded.toJSON())).not.toContain('accessToken');

    const withToken = await SocialConnection.findById(conn._id).select('+accessToken');
    expect(withToken.getAccessToken()).toBe('EAAG-long-lived-user-token');
    expect(withToken.toJSON()).not.toHaveProperty('accessToken');
  });
});

describe('SocialAccount (publishing destinations)', () => {
  it('lets one identity provide many Pages and Instagram accounts', async () => {
    const ws = oid();
    const conn = await SocialConnection.create(connectionDoc(ws, 'fb-user-a'));
    for (const id of ['p1', 'p2', 'p3']) await SocialAccount.create(pageDoc(ws, conn._id, id));
    await SocialAccount.create(pageDoc(ws, conn._id, 'ig1', SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT));
    expect(await SocialAccount.countDocuments({ connection: conn._id })).toBe(4);
  });

  it('registers each destination once per workspace', async () => {
    const ws = oid();
    const a = await SocialConnection.create(connectionDoc(ws, 'fb-user-a'));
    const b = await SocialConnection.create(connectionDoc(ws, 'fb-user-b'));
    await SocialAccount.create(pageDoc(ws, a._id, 'shared-page'));
    // A second identity that can reach the same Page does not create a duplicate destination.
    await expect(SocialAccount.create(pageDoc(ws, b._id, 'shared-page'))).rejects.toThrow(
      /duplicate key/i,
    );
    // The same Page id on a different platform or in another workspace is distinct.
    await SocialAccount.create(
      pageDoc(ws, a._id, 'shared-page', SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT),
    );
    await SocialAccount.create(pageDoc(oid(), a._id, 'shared-page'));
  });

  it('tracks connection health and publishing readiness independently', async () => {
    const ws = oid();
    const conn = await SocialConnection.create(connectionDoc(ws, 'fb-user-a'));
    const page = await SocialAccount.create({
      ...pageDoc(ws, conn._id, 'p1'),
      publishingStatus: 'RESTRICTED',
      publishingStatusReason: 'Missing pages_manage_posts',
    });
    expect(page.connectionStatus).toBe('ACTIVE');
    expect(page.publishingStatus).toBe('RESTRICTED');
  });

  it('rejects unknown platforms and statuses', async () => {
    const ws = oid();
    await expect(
      SocialAccount.create({ ...pageDoc(ws, oid(), 'x'), platform: 'TIKTOK' }),
    ).rejects.toThrow();
    await expect(
      SocialAccount.create({ ...pageDoc(ws, oid(), 'y'), connectionStatus: 'HAPPY' }),
    ).rejects.toThrow();
  });
});

describe('account access checks', () => {
  it('scopes SELECTED members and never leaks across workspaces', async () => {
    const ws = oid();
    const conn = await SocialConnection.create(connectionDoc(ws, 'fb-user-a'));
    const [p1, p2] = [
      await SocialAccount.create(pageDoc(ws, conn._id, 'p1')),
      await SocialAccount.create(pageDoc(ws, conn._id, 'p2')),
    ];
    const foreign = await SocialAccount.create(pageDoc(oid(), conn._id, 'p3'));

    const editor = {
      workspace: ws,
      role: 'EDITOR',
      accountAccess: { mode: 'SELECTED', socialAccounts: [p1._id] },
    };
    expect(await canAccessAccount(editor, p1._id)).toBe(true);
    expect(await canAccessAccount(editor, p2._id)).toBe(false);

    const allEditor = {
      workspace: ws,
      role: 'EDITOR',
      accountAccess: { mode: 'ALL', socialAccounts: [] },
    };
    expect(await canAccessAccount(allEditor, p2._id)).toBe(true);
    expect(await canAccessAccount(allEditor, foreign._id)).toBe(false);

    const admin = {
      workspace: ws,
      role: 'ADMIN',
      accountAccess: { mode: 'SELECTED', socialAccounts: [] },
    };
    expect(await canAccessAccount(admin, p2._id)).toBe(true);
    expect(await canAccessAccount(admin, 'not-an-id')).toBe(false);
  });
});
