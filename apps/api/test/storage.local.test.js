import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { buildStorage } from '../src/storage/index.js';

/**
 * STORAGE_LOCAL_DIR: an absolute directory (another drive, spaces in its name) that is
 * created at start, and from which no key can escape. The live check against the configured
 * directory is `npm run storage:verify-local -w @socialhub/api`.
 */
const base = mkdtempSync(path.join(os.tmpdir(), 'socialhub local dir '));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const local = (directory) => buildStorage({ driver: 'local', local: { directory } });

describe('local storage directory', () => {
  it('reads the directory from the environment, quoted paths with spaces included', () => {
    const env = {
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(loadConfig(env).storage.local.directory).toBe('./storage-data');
    const config = loadConfig({
      ...env,
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: 'F:/Social Hub Data',
    });
    expect(config.storage).toMatchObject({
      driver: 'local',
      local: { directory: 'F:/Social Hub Data' },
    });
  });

  it('creates a missing directory, with separate folders for uploads and verified files', () => {
    const directory = path.join(base, 'Social Hub Data', 'nested level');
    expect(existsSync(directory)).toBe(false);
    const storage = local(directory);
    expect(storage.name).toBe('local');
    expect(statSync(path.join(directory, 'uploads')).isDirectory()).toBe(true);
    expect(statSync(path.join(directory, 'workspaces')).isDirectory()).toBe(true);
    // Starting again with the folders in place is fine and keeps what is there.
    writeFileSync(path.join(directory, 'workspaces', 'keep.txt'), 'kept');
    local(directory);
    expect(existsSync(path.join(directory, 'workspaces', 'keep.txt'))).toBe(true);
  });

  it('fails with a clear message when the directory cannot be created', () => {
    const file = path.join(base, 'a-file');
    writeFileSync(file, 'x');
    expect(() => local(path.join(file, 'below'))).toThrow(/STORAGE_LOCAL_DIR .* cannot be created/);
  });

  it('writes below the directory only: no key can leave it', async () => {
    const directory = path.join(base, 'jail dir');
    const storage = local(directory);
    writeFileSync(path.join(base, 'outside.txt'), 'secret');
    const bad = [
      '../outside.txt',
      'workspaces/../../outside.txt',
      'workspaces/..',
      '..',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'C:\\Windows\\win.ini',
      'workspaces\\..\\..\\outside.txt',
      'workspaces//x.jpg',
      'workspaces/a b.jpg',
      'workspaces/%2e%2e/x.jpg',
      '',
    ];
    for (const key of bad) {
      await expect(storage.stat(key), key).rejects.toMatchObject({ status: 404 });
      await expect(storage.read(key, 0, 10), key).rejects.toMatchObject({ status: 404 });
      await expect(storage.remove(key), key).rejects.toMatchObject({ status: 404 });
      await expect(storage.copy('workspaces/a.jpg', key), key).rejects.toMatchObject({
        status: 404,
      });
    }
    expect(existsSync(path.join(base, 'outside.txt'))).toBe(true);
    // A well-formed key that does not exist is simply missing.
    expect(await storage.stat('workspaces/abc/media/def/file.jpg')).toBeNull();
  });

  it('copies from the upload area to the verified area and keeps the bytes', async () => {
    const directory = path.join(base, 'copy dir');
    const storage = local(directory);
    writeFileSync(path.join(directory, 'uploads', 'in.jpg'), 'image-bytes');
    expect(await storage.copy('uploads/in.jpg', 'workspaces/w1/media/m1/out.jpg')).toBe(true);
    expect((await storage.read('workspaces/w1/media/m1/out.jpg', 0, 100)).toString()).toBe(
      'image-bytes',
    );
    expect(await storage.copy('uploads/missing.jpg', 'workspaces/w1/media/m1/x.jpg')).toBe(false);
    await storage.remove('workspaces/w1/media/m1/out.jpg');
    expect(await storage.stat('workspaces/w1/media/m1/out.jpg')).toBeNull();
    expect(storage.publicUrls).toBe(false);
    expect(storage.publicUrl('workspaces/w1/x.jpg')).not.toContain(directory);
  });
});
