/**
 * Verifies the configured S3-compatible bucket with REAL requests.
 *
 *   npm run storage:verify -w @socialhub/api
 *
 * It uses the same driver the API uses (src/storage/s3Storage.js) and plays both sides:
 * the browser (PUT to the signed upload link) and the API (stat, copy, read, delete).
 * It writes two small test objects under `uploads/_verify/` and `workspaces/_verify/` and
 * removes them at the end. It never prints credentials or signed URLs.
 *
 * Exit code 0 only when every required check passes. A PASS here is evidence about THIS
 * bucket at this moment; the automated tests use a simulated provider and are not.
 */
import { randomBytes } from 'node:crypto';
import { config } from '../src/config/env.js';
import { createS3Storage } from '../src/storage/s3Storage.js';

const results = [];
const record = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pass = (name, detail) => record('PASS', name, detail);
const fail = (name, detail) => record('FAIL', name, detail);
const warn = (name, detail) => record('WARN', name, detail);
const check = (ok, name, detail) => (ok ? pass(name, detail) : fail(name, detail));

/** A small but genuine JPEG header (640×480), padded to `size` bytes. */
function jpeg(size, fill) {
  const head = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22,
    0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, fill)]);
}

const put = (upload, bytes, headers = upload.headers) =>
  fetch(upload.url, { method: 'PUT', headers, body: bytes }).catch((err) => ({
    status: 0,
    error: err.message,
  }));

async function publicBytes(url) {
  const res = await fetch(`${url}?verify=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  if (!res) return { status: 0, bytes: null };
  return { status: res.status, bytes: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}

async function main() {
  if (config.storage.driver !== 's3') {
    console.log(
      `STORAGE_DRIVER is "${config.storage.driver ?? ''}". This check is for STORAGE_DRIVER=s3; set it and the STORAGE_S3_* variables in apps/api/.env first.`,
    );
    process.exitCode = 2;
    return;
  }
  const settings = config.storage.s3;
  const storage = createS3Storage(settings);
  console.log(
    `Bucket "${settings.bucket}" (${settings.endpoint ?? `AWS ${settings.region}`}), public base ${settings.publicBaseUrl}\n`,
  );

  const id = randomBytes(9).toString('base64url');
  const uploadKey = `uploads/_verify/${id}.jpg`;
  const finalKey = `workspaces/_verify/media/${id}.jpg`;
  const original = jpeg(4096, 0x11);
  const altered = jpeg(4096, 0x77); // same size, different content
  const upload = storage.createUpload({
    key: uploadKey,
    contentType: 'image/jpeg',
    sizeBytes: original.length,
    expiresInSeconds: 300,
  });

  try {
    // --- the link only accepts the announced type and size ---
    const wrongType = await put(upload, original, { 'Content-Type': 'text/html' });
    check(
      wrongType.status === 403,
      'Upload link refuses another Content-Type',
      `HTTP ${wrongType.status}`,
    );
    const wrongSize = await put(upload, Buffer.concat([original, original]));
    check(wrongSize.status === 403, 'Upload link refuses another size', `HTTP ${wrongSize.status}`);

    // --- upload ---
    const first = await put(upload, original);
    check(
      first.status === 200,
      'Upload through the signed link',
      `HTTP ${first.status} ${first.error ?? ''}`,
    );
    if (first.status !== 200) return;

    // --- completion: stat, copy to the final key, read it back ---
    const stat = await storage.stat(uploadKey);
    check(stat?.sizeBytes === original.length, 'Stored size matches', `${stat?.sizeBytes} bytes`);
    const copied = await storage.copy(uploadKey, finalKey);
    check(copied === true, 'Server-side copy to the final key');
    const head = await storage.read(finalKey, 0, 64);
    check(Buffer.compare(head, original.subarray(0, 64)) === 0, 'Ranged read of the final object');
    // Completion relies on this: "not uploaded yet" must read as missing, not as an error.
    const missing = await storage.stat('uploads/_verify/does-not-exist.jpg').then(
      (found) => ({ found }),
      (err) => ({ error: err.message }),
    );
    check(
      missing.found === null,
      'Missing object reads as missing',
      missing.error ? `permissions: ${missing.error}` : '',
    );

    // --- public delivery ---
    const url = storage.publicUrl(finalKey);
    const served = await publicBytes(url);
    check(
      served.bytes !== null && Buffer.compare(served.bytes, original) === 0,
      'Public HTTPS delivery of the final object',
      `HTTP ${served.status}`,
    );
    if (!url.startsWith('https://'))
      fail('Public base URL is HTTPS', 'Meta only fetches HTTPS media');

    // --- the overwrite check ---
    const reuse = await put(upload, altered);
    if (reuse.status === 200) {
      pass(
        'Reused link was accepted by the bucket',
        'expected: it can rewrite the upload object only',
      );
    } else {
      pass('Reused link was refused by the bucket', `HTTP ${reuse.status}`);
    }
    const afterStorage = await storage.read(finalKey, 0, original.length);
    check(
      Buffer.compare(afterStorage, original) === 0,
      'Final object is unchanged after reusing the link with a same-size file',
    );
    const afterPublic = await publicBytes(url);
    check(
      afterPublic.bytes !== null && Buffer.compare(afterPublic.bytes, original) === 0,
      'Publicly served bytes are unchanged',
      `HTTP ${afterPublic.status}`,
    );
    const forged = new URL(upload.url);
    forged.pathname = forged.pathname.replace(encodeURI(uploadKey), encodeURI(finalKey));
    const direct = await put({ ...upload, url: forged.toString() }, altered);
    check(
      direct.status === 403,
      'Link cannot be re-pointed at the final key',
      `HTTP ${direct.status}`,
    );

    // --- browser upload needs CORS ---
    const origin = config.clientOrigins[0];
    const preflight = await fetch(upload.url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    }).catch(() => null);
    const allowed = preflight?.headers.get('access-control-allow-origin');
    if (preflight?.ok && (allowed === origin || allowed === '*')) {
      pass('Bucket CORS allows PUT from the web app', origin);
    } else {
      fail(
        'Bucket CORS allows PUT from the web app',
        `${origin}: HTTP ${preflight?.status ?? 0}. Add a CORS rule for PUT with Content-Type`,
      );
    }

    // --- the bucket must not be listable ---
    const listing = await fetch(settings.publicBaseUrl).catch(() => null);
    const text = listing?.ok ? await listing.text() : '';
    if (/<ListBucketResult/i.test(text))
      fail('Bucket listing is disabled', 'the public URL returns an object listing');
    else pass('Bucket listing is disabled', `HTTP ${listing?.status ?? 0}`);
  } finally {
    // --- deletion ---
    await storage.remove(uploadKey).catch(() => {});
    await storage.remove(finalKey).catch(() => {});
    const gone = (await storage.stat(finalKey).catch(() => 'error')) === null;
    check(gone, 'Deletion removes the object');
    const afterDelete = await publicBytes(storage.publicUrl(finalKey));
    if (afterDelete.bytes === null)
      pass('Deleted object is no longer served', `HTTP ${afterDelete.status}`);
    else warn('Deleted object is still served', 'a CDN cache may keep it for a while');
  }
}

await main().catch((err) => {
  fail('Verification aborted', err.message);
});
const failed = results.filter((r) => r === 'FAIL').length;
if (results.length) {
  console.log(
    `\n${failed === 0 ? 'All required checks passed' : `${failed} check(s) FAILED`} (${results.filter((r) => r === 'PASS').length} passed, ${results.filter((r) => r === 'WARN').length} warnings).`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
