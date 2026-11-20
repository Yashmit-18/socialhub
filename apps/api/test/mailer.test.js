import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { outbox, sendPasswordResetEmail } from '../src/lib/mailer.js';

const mailerUrl = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/mailer.js'),
).href;

describe('mailer without SMTP', () => {
  it('keeps messages in the dev/test outbox so links are reachable', async () => {
    const result = await sendPasswordResetEmail({
      to: 'dev@example.com',
      name: 'Dev',
      url: 'http://localhost:5173/reset-password?token=abc',
      ttlMinutes: 30,
    });
    expect(result.delivered).toBe(false);
    expect(outbox.at(-1)).toMatchObject({
      to: 'dev@example.com',
      meta: { kind: 'password_reset' },
    });
  });

  it('never logs or retains secret links in production', () => {
    // Config is read at import time, so production behaviour is exercised in a fresh process.
    const script = `
      const { sendPasswordResetEmail, outbox } = await import(${JSON.stringify(mailerUrl)});
      await sendPasswordResetEmail({ to: 'a@example.com', name: 'A', url: 'https://app/reset-password?token=SECRET-RESET-TOKEN', ttlMinutes: 30 });
      console.log('OUTBOX=' + outbox.length);
      process.exit(0);`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(output).toContain('OUTBOX=0');
    expect(output).toContain('Email not delivered');
    expect(output).not.toContain('SECRET-RESET-TOKEN');
  }, 60_000);
});
