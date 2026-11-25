// Database backups and encryption-key rotation (src/maintenance). Runs only against the
// throwaway in-memory test database; no real data, keys or tokens are involved.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config/env.js';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';
import {
  backupDatabase,
  restoreDatabase,
  verifyBackup,
} from '../src/maintenance/databaseBackup.js';
import { parseEncryptionKey, rotateTokenKey } from '../src/maintenance/tokenKeyRotation.js';
import { SocialAccount, SocialConnection } from '../src/models/index.js';

let dir;
let other;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'socialhub-backup-test-'));
});
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  if (other) await other.dropDatabase();
  other = null;
});

const db = () => mongoose.connection.db;
const emptyDatabase = () => {
  other = mongoose.connection.client.db(`socialhub_restore_${randomUUID().slice(0, 8)}`);
  return other;
};

describe('database backup and restore', () => {
  async function seed() {
    const id = new mongoose.Types.ObjectId();
    const when = new Date('2026-11-24T10:37:36.000Z');
    await db().collection('workspaces').insertOne({ _id: id, name: 'Acme', createdAt: when });
    await db()
      .collection('activitylogs')
      .insertMany([
        { workspace: id, action: 'a', at: when },
        { workspace: id, action: 'b', count: 2 },
      ]);
    return { id, when };
  }

  it('backs up every collection and restores it exactly into an empty database', async () => {
    const { id, when } = await seed();
    const manifest = await backupDatabase(db(), dir);
    const byName = Object.fromEntries(manifest.collections.map((c) => [c.name, c]));
    expect(byName.workspaces.count).toBe(1);
    expect(byName.activitylogs.count).toBe(2);
    expect(await verifyBackup(dir)).toEqual([]);

    const target = emptyDatabase();
    const { restored } = await restoreDatabase(target, dir);
    expect(restored).toMatchObject({ workspaces: 1, activitylogs: 2 });
    // ObjectIds and dates survive as their own types, not as strings.
    const workspace = await target.collection('workspaces').findOne({ _id: id });
    expect(workspace.createdAt).toBeInstanceOf(Date);
    expect(workspace.createdAt.getTime()).toBe(when.getTime());
    expect(await target.collection('activitylogs').countDocuments({ workspace: id })).toBe(2);
  });

  it('refuses to restore into a database that already has data, writing nothing', async () => {
    await seed();
    await backupDatabase(db(), dir);
    const target = emptyDatabase();
    await target.collection('activitylogs').insertOne({ existing: true });
    await expect(restoreDatabase(target, dir)).rejects.toThrow(/already has data \(activitylogs\)/);
    expect(await target.collection('workspaces').countDocuments()).toBe(0);
    expect(await target.collection('activitylogs').countDocuments()).toBe(1);
  });

  it('detects a damaged backup and restores nothing from it', async () => {
    await seed();
    await backupDatabase(db(), dir);
    const file = path.join(dir, 'activitylogs.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"a"', '"x"'));
    expect(await verifyBackup(dir)).toEqual(['activitylogs.jsonl: checksum does not match']);
    const target = emptyDatabase();
    await expect(restoreDatabase(target, dir)).rejects.toThrow(/damaged/);
    expect(await target.collection('workspaces').countDocuments()).toBe(0);
  });

  it('rejects a manifest that points outside the backup folder', async () => {
    await seed();
    await backupDatabase(db(), dir);
    const manifestFile = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifest.collections[0].file = '../../outside.jsonl';
    writeFileSync(manifestFile, JSON.stringify(manifest));
    await expect(verifyBackup(dir)).rejects.toThrow(/Unexpected file name/);
  });
});

describe('encryption-key rotation', () => {
  const newKey = randomBytes(32);
  const tokenOf = (doc, key) => decryptSecret(doc.accessToken, key);

  async function storeToken(Model, plain, key = config.tokenEncryptionKey) {
    // A distinct externalId keeps raw test documents clear of the unique destination index.
    const { insertedId } = await Model.collection.insertOne({
      externalId: randomUUID(),
      accessToken: encryptSecret(plain, key),
    });
    return insertedId;
  }

  it('reports in a dry run and changes nothing', async () => {
    await storeToken(SocialConnection, 'user-token-1');
    await storeToken(SocialAccount, 'page-token-1');
    const before = await SocialAccount.collection.findOne({});
    const report = await rotateTokenKey({ currentKey: config.tokenEncryptionKey, newKey });
    expect(report.models.SocialConnection).toMatchObject({ tokens: 1, toRotate: 1, rotated: 0 });
    expect(report.models.SocialAccount).toMatchObject({ tokens: 1, toRotate: 1 });
    expect(await SocialAccount.collection.findOne({})).toEqual(before);
  });

  it('re-encrypts every token with the new key, verifies it, and can run again safely', async () => {
    const connId = await storeToken(SocialConnection, 'user-token-1');
    const pageId = await storeToken(SocialAccount, 'page-token-1');
    await SocialAccount.collection.insertOne({ externalId: randomUUID(), name: 'no token' });

    const report = await rotateTokenKey({
      currentKey: config.tokenEncryptionKey,
      newKey,
      apply: true,
    });
    expect(report.models.SocialConnection).toMatchObject({ rotated: 1, verifiedWithNewKey: 1 });
    expect(report.models.SocialAccount).toMatchObject({ rotated: 1, verifiedWithNewKey: 1 });
    expect(tokenOf(await SocialConnection.collection.findOne({ _id: connId }), newKey)).toBe(
      'user-token-1',
    );
    const page = await SocialAccount.collection.findOne({ _id: pageId });
    expect(tokenOf(page, newKey)).toBe('page-token-1');
    expect(() => tokenOf(page, config.tokenEncryptionKey)).toThrow();

    const again = await rotateTokenKey({
      currentKey: config.tokenEncryptionKey,
      newKey,
      apply: true,
    });
    expect(again.models.SocialAccount).toMatchObject({ alreadyNewKey: 1, rotated: 0 });
  });

  it('writes nothing when any token cannot be read with either key', async () => {
    const good = await storeToken(SocialConnection, 'user-token-1');
    const bad = await storeToken(SocialAccount, 'page-token-x', randomBytes(32));
    const before = await SocialConnection.collection.findOne({ _id: good });
    await expect(
      rotateTokenKey({ currentKey: config.tokenEncryptionKey, newKey, apply: true }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/1 token\(s\) cannot be read/),
      report: { models: { SocialAccount: { unreadableIds: [String(bad)] } } },
    });
    expect(await SocialConnection.collection.findOne({ _id: good })).toEqual(before);
  });

  it('refuses the same key and malformed keys', async () => {
    await expect(
      rotateTokenKey({ currentKey: config.tokenEncryptionKey, newKey: config.tokenEncryptionKey }),
    ).rejects.toThrow(/same as the current key/);
    expect(() => parseEncryptionKey('too-short', 'NEW_TOKEN_ENCRYPTION_KEY')).toThrow(
      /NEW_TOKEN_ENCRYPTION_KEY must be 32 bytes/,
    );
    expect(parseEncryptionKey(randomBytes(32).toString('base64')).length).toBe(32);
  });
});
