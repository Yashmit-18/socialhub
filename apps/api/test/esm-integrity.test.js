import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function listModules(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listModules(full);
    return name.endsWith('.js') && name !== 'server.js' ? [full] : [];
  });
}

/**
 * Vitest's module transform turns a missing named export into `undefined` instead of a
 * link error. This loads every module under Node's real ESM loader so such mistakes fail CI.
 */
describe('ESM integrity', () => {
  it('links every source module under the native Node loader', () => {
    const modules = listModules(srcDir).map((f) => pathToFileURL(f).href);
    // Exit explicitly: imported modules (e.g. the mail transport) may hold the event loop open.
    const script = `for (const m of ${JSON.stringify(modules)}) await import(m); process.exit(0);`;
    const run = () =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, LOG_LEVEL: 'silent' },
        stdio: 'pipe',
        timeout: 60_000,
      });
    expect(run).not.toThrow();
    expect(modules.length).toBeGreaterThan(20);
  }, 90_000);
});
