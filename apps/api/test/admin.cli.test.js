import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { emailSchema } from '@socialhub/shared';
import {
  CLI_ACTOR_NAME,
  grantPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from '../src/maintenance/platformAdmin.js';
import { PlatformAuditLog, User } from '../src/models/index.js';
import { setAnalyticsQueueForTests } from '../src/queue/analyticsQueue.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { adminUrl, client, signUp } from './adminFixtures.js';
import { createTestQueue } from './publishFixtures.js';

/**
 * The command line is the only way to give or remove platform admin access. The core is tested
 * directly; the wrapper is run as its own process against this test's in-memory database (never
 * a real one: MONGODB_URI is pointed at the test server and no .env file is read).
 */

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

beforeEach(() => {
  setPublishQueueForTests(createTestQueue());
  setAnalyticsQueueForTests(null);
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setAnalyticsQueueForTests(undefined);
});

const entries = (action) => PlatformAuditLog.find({ action }).sort({ _id: 1 }).lean();

describe('platform admin core', () => {
  it('gives access to an existing account, once, and records it as the command line', async () => {
    const ada = await signUp({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(await grantPlatformAdmin('nobody@example.com')).toEqual({
      code: 'NOT_FOUND',
      user: null,
    });

    const granted = await grantPlatformAdmin('ada@example.com');
    expect(granted).toEqual({
      code: 'GRANTED',
      user: { id: ada.user.id, name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    expect((await User.findById(ada.user.id)).platformRole).toBe('PLATFORM_ADMIN');
    const [entry] = await entries('platform.admin_granted');
    expect(entry).toMatchObject({
      actorName: CLI_ACTOR_NAME,
      target: { type: 'user', label: 'Ada Lovelace' },
      metadata: { email: 'ada@example.com', via: 'CLI' },
    });
    expect(entry.actor).toBeUndefined();
    expect(String(entry.target.id)).toBe(ada.user.id);

    expect((await grantPlatformAdmin('ada@example.com')).code).toBe('ALREADY_ADMIN');
    expect(await entries('platform.admin_granted')).toHaveLength(1);
    // Takes effect on the next request.
    expect((await client(ada.token).get(adminUrl('/overview'))).status).toBe(200);
  });

  it('never makes a suspended account a platform admin', async () => {
    const sus = await signUp({ name: 'Sus Pended', email: 'sus@example.com' });
    await User.updateOne({ _id: sus.user.id }, { $set: { status: 'DISABLED' } });
    expect(await grantPlatformAdmin('sus@example.com')).toEqual({
      code: 'SUSPENDED',
      user: { id: sus.user.id, name: 'Sus Pended', email: 'sus@example.com' },
    });
    expect((await User.findById(sus.user.id)).platformRole).toBeUndefined();
    expect(await entries('platform.admin_granted')).toHaveLength(0);
  });

  it('removes access, says how many are left, and may remove the last one', async () => {
    const ada = await signUp({ name: 'Ada Lovelace', email: 'ada@example.com' });
    await signUp({ name: 'Grace Hopper', email: 'grace@example.com' });
    await grantPlatformAdmin('ada@example.com');
    await grantPlatformAdmin('grace@example.com');

    expect(await revokePlatformAdmin('nobody@example.com')).toEqual({
      code: 'NOT_FOUND',
      user: null,
      remaining: 2,
    });
    expect(await revokePlatformAdmin('grace@example.com')).toMatchObject({
      code: 'REVOKED',
      remaining: 1,
    });
    expect((await revokePlatformAdmin('grace@example.com')).code).toBe('NOT_ADMIN');
    expect(await revokePlatformAdmin('ada@example.com')).toMatchObject({
      code: 'REVOKED',
      user: { id: ada.user.id },
      remaining: 0,
    });
    expect((await User.findById(ada.user.id)).platformRole).toBeUndefined();
    const revoked = await entries('platform.admin_revoked');
    expect(revoked.map((e) => e.metadata)).toEqual([
      { email: 'grace@example.com', via: 'CLI' },
      { email: 'ada@example.com', via: 'CLI' },
    ]);
    expect((await client(ada.token).get(adminUrl('/overview'))).status).toBe(404);
  });

  it('lists platform admins, oldest account first, with their status', async () => {
    expect(await listPlatformAdmins()).toEqual([]);
    const first = await signUp({ name: 'First', email: 'first@example.com' });
    const second = await signUp({ name: 'Second', email: 'second@example.com' });
    await signUp({ name: 'Not Admin', email: 'plain@example.com' });
    await grantPlatformAdmin('second@example.com');
    await grantPlatformAdmin('first@example.com');
    expect(await listPlatformAdmins()).toEqual([
      { id: first.user.id, name: 'First', email: 'first@example.com', status: 'ACTIVE' },
      { id: second.user.id, name: 'Second', email: 'second@example.com', status: 'ACTIVE' },
    ]);
  });

  it('expects the address the wrapper normalises: trimmed and in lower case', async () => {
    await signUp({ name: 'Ada Lovelace', email: 'ada@example.com' });
    const email = emailSchema.parse('  ADA@Example.COM ');
    expect(email).toBe('ada@example.com');
    expect((await grantPlatformAdmin(email)).code).toBe('GRANTED');
  });
});

describe('the command-line wrapper', () => {
  /** Runs scripts/platform-admin.js against this test file's own in-memory database. */
  function run(...args) {
    const uri = new URL(inject('mongoUri'));
    uri.pathname = `/${mongoose.connection.name}`;
    const result = spawnSync(process.execPath, ['scripts/platform-admin.js', ...args], {
      cwd: apiDir,
      env: { ...process.env, MONGODB_URI: uri.toString(), LOG_LEVEL: 'silent' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
  }

  it('refuses a wrong call with the usage text and exit code 64, before connecting', () => {
    for (const args of [[], ['promote', 'ada@example.com'], ['grant'], ['grant', 'not-an-email']]) {
      const { code, err, out } = run(...args);
      expect(code).toBe(64);
      expect(err).toContain('npm run admin:grant  -w @socialhub/api -- person@example.com');
      expect(out).toBe('');
    }
  }, 60_000);

  it('grants, lists and revokes, trimming and lower-casing the address', async () => {
    const ada = await signUp({ name: 'Ada Lovelace', email: 'ada@example.com' });

    const missing = run('grant', 'nobody@example.com');
    expect(missing.code).toBe(1);
    expect(missing.out).toBe(
      'No SocialHub account uses nobody@example.com. The person has to register first.',
    );

    const none = run('list');
    expect(none.code).toBe(0);
    expect(none.out).toContain('There is no platform admin yet.');

    const granted = run('grant', '  ADA@Example.COM ');
    expect(granted.code).toBe(0);
    expect(granted.out).toBe(
      `Platform admin access given to Ada Lovelace <ada@example.com> (id ${ada.user.id}).\n` +
        'They reload SocialHub to see "Admin console" in the sidebar.',
    );
    expect((await User.findById(ada.user.id)).platformRole).toBe('PLATFORM_ADMIN');
    expect(run('grant', 'ada@example.com').out).toBe(
      'Ada Lovelace <ada@example.com> is already a platform admin. Nothing was changed.',
    );

    const listed = run('list');
    expect(listed.out).toBe(
      `Platform admins (1):\n  Ada Lovelace <ada@example.com>  id ${ada.user.id}`,
    );

    const revoked = run('revoke', 'ada@example.com');
    expect(revoked.code).toBe(0);
    expect(revoked.out).toContain(
      'Platform admin access removed from Ada Lovelace <ada@example.com>',
    );
    expect(revoked.out).toContain('No platform admin is left.');
    expect((await User.findById(ada.user.id)).platformRole).toBeUndefined();
    // Nothing secret is printed.
    expect(`${granted.out}${listed.out}${revoked.out}`).not.toMatch(
      /\$2[aby]\$|passwordHash|token/i,
    );
  }, 90_000);
});
