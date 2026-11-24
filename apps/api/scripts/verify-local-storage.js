/**
 * End-to-end check of STORAGE_DRIVER=local against the REAL configured directory.
 *
 *   node --env-file-if-exists=.env scripts/verify-local-storage.js      (from apps/api)
 *
 * It starts the real API (src/server.js) with the storage settings from apps/api/.env, but
 * against a temporary, private MongoDB, so the configured database is never read or written.
 * It then uploads a small image and a small video over HTTP exactly as the browser does,
 * looks at the files on disk, restarts the API, and exercises deletion and the clean-up
 * script. Everything it creates is removed at the end; files it did not create are never
 * touched.
 *
 * The test files are minimal but structurally valid JPEG and MP4 files (a few hundred bytes).
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, rmdir, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const results = [];
const check = (ok, name, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/* ------------------------------------------------------------------ test files */
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
function jpegBytes(width, height) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    u16(16),
    Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
    Buffer.from([0xff, 0xc0]),
    u16(17),
    Buffer.from([8]),
    u16(height),
    u16(width),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    randomBytes(256), // makes every run's file unique
    Buffer.from([0xff, 0xd9]),
  ]);
}
const box = (type, ...parts) => {
  const payload = Buffer.concat(parts);
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type, 'latin1'), payload]);
};
function mp4Bytes(width, height, durationSec) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(durationSec * 1000), 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom', 'latin1'), u32(0), Buffer.from('isommp42', 'latin1')),
    box('mdat', randomBytes(2048)),
    box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd))),
  ]);
}

/* ------------------------------------------------------------------ helpers */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push({ file: path.relative(base, full), size: (await stat(full)).size });
  }
  return out;
}

/** Removes now-empty folders this run created, never anything that still holds a file. */
async function pruneEmpty(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt + path.sep)) {
    try {
      await rmdir(current); // fails unless empty
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function startApi(env) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: apiDir,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stderrText = () => stderr;
  return child;
}

const stopApi = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });

async function waitForApi(base, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`API exited early: ${child.stderrText()}`);
    const res = await fetch(`${base}/health`).catch(() => null);
    if (res?.ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API did not start in 60 seconds');
}

async function main() {
  if (process.env.STORAGE_DRIVER !== 'local') {
    console.log(
      `STORAGE_DRIVER is "${process.env.STORAGE_DRIVER ?? ''}". Set STORAGE_DRIVER=local and STORAGE_LOCAL_DIR in apps/api/.env first.`,
    );
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(apiDir, process.env.STORAGE_LOCAL_DIR ?? './storage-data');
  console.log(`Storage directory: ${root}\n`);
  const before = await listFiles(root);

  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/api/v1`;
  // Links for the browser are same-origin paths; resolve them like a browser on this API would.
  const absolute = (url) => new URL(url, origin).toString();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    LOG_LEVEL: 'error',
    PORT: String(port),
    MONGODB_URI: mongo.getUri('socialhub_storage_check'),
    API_PUBLIC_URL: origin,
    AUTH_RATE_LIMIT_MAX: '1000',
  };
  let apiProcess = startApi(env);
  const created = { workspaces: [] };

  const call = async (token, method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const signUp = async (label) => {
    const res = await call(null, 'POST', '/auth/register', {
      name: `Storage Check ${label}`,
      email: `storage.check.${label}.${Date.now()}@example.com`,
      password: `Check-${randomBytes(9).toString('base64url')}1!`,
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
    const ws = await call(res.body.accessToken, 'POST', '/workspaces', {
      name: `Storage check ${label}`,
    });
    if (ws.status !== 201) throw new Error(`workspace failed: ${ws.status}`);
    created.workspaces.push(ws.body.workspace.id);
    return { token: res.body.accessToken, ws: ws.body.workspace.id };
  };
  const slot = (who, file) =>
    call(who.token, 'POST', `/workspaces/${who.ws}/media/uploads`, {
      fileName: file.name,
      kind: file.kind,
      mimeType: file.type,
      sizeBytes: file.bytes.length,
    });
  const put = (upload, bytes) =>
    fetch(absolute(upload.url), { method: upload.method, headers: upload.headers, body: bytes });
  const complete = (who, id) =>
    call(who.token, 'POST', `/workspaces/${who.ws}/media/${id}/complete`);
  const filesOf = async (ws) =>
    (await listFiles(root)).filter((f) => f.file.split(path.sep).includes(ws));
  const onDisk = async (ws, id, area) =>
    (await filesOf(ws)).filter(
      (f) => f.file.startsWith(area + path.sep) && f.file.split(path.sep).includes(id),
    );

  try {
    await waitForApi(base, apiProcess);
    check(existsSync(root), '1. Storage directory exists', root);

    const alice = await signUp('a');
    const bob = await signUp('b');
    const image = {
      name: '../..\\evil name?.jpg'.replace(/[/\\]/g, '_'),
      kind: 'IMAGE',
      type: 'image/jpeg',
      bytes: jpegBytes(1080, 1350),
    };
    const video = {
      name: 'clip.mp4',
      kind: 'VIDEO',
      type: 'video/mp4',
      bytes: mp4Bytes(1080, 1920, 7),
    };

    // A file name with path characters is refused outright.
    const badName = await slot(alice, { ...image, name: '..\\..\\Windows\\x.jpg' });
    check(
      badName.status === 422,
      '12a. File name with path characters is refused',
      `HTTP ${badName.status}`,
    );

    /* ---- image ---- */
    const imageSlot = await slot(alice, image);
    const imageId = imageSlot.body?.media?.id;
    check(imageSlot.status === 201, '2a. Image upload slot issued', `HTTP ${imageSlot.status}`);
    const imagePut = await put(imageSlot.body.upload, image.bytes);
    check(imagePut.status === 200, '2b. Image bytes accepted', `HTTP ${imagePut.status}`);
    const imageTemp = await onDisk(alice.ws, imageId, 'uploads');
    check(
      imageTemp.length === 1 && imageTemp[0].size === image.bytes.length,
      '4a. Image is on disk under uploads\\ (temporary)',
      imageTemp[0]?.file,
    );
    const imageDone = await complete(alice, imageId);
    check(
      imageDone.body?.media?.status === 'READY' &&
        imageDone.body.media.width === 1080 &&
        imageDone.body.media.height === 1350,
      '5a. Image verified (READY, 1080×1350 read from the file)',
      `status ${imageDone.body?.media?.status}`,
    );
    const imageFinal = await onDisk(alice.ws, imageId, 'workspaces');
    const imageFinalBytes = imageFinal[0]
      ? await readFile(path.join(root, imageFinal[0].file))
      : null;
    check(
      imageFinal.length === 1 && imageFinalBytes && sha(imageFinalBytes) === sha(image.bytes),
      '6a. Image copied to workspaces\\ with identical content',
      `${imageFinal[0]?.file} (${imageFinal[0]?.size} bytes, sha256 ${imageFinalBytes ? sha(imageFinalBytes) : '-'})`,
    );
    const imageTempAfter = await onDisk(alice.ws, imageId, 'uploads');
    check(
      imageTempAfter.length === 1 && imageTempAfter[0].size === 0,
      '6b. Temporary upload file emptied after the copy',
    );
    const reuse = await put(imageSlot.body.upload, image.bytes);
    check(reuse.status === 409, '6c. Upload link works only once', `HTTP ${reuse.status}`);
    check(
      !imageFinal[0].file.includes('evil') && !JSON.stringify(imageDone.body).includes(root),
      '12b. Stored path is server-generated; no disk path in the API answer',
    );

    /* ---- video ---- */
    const videoSlot = await slot(alice, video);
    const videoId = videoSlot.body?.media?.id;
    const videoPut = await put(videoSlot.body.upload, video.bytes);
    check(
      videoSlot.status === 201 && videoPut.status === 200,
      '3a. Video uploaded',
      `HTTP ${videoPut.status}`,
    );
    const videoDone = await complete(alice, videoId);
    check(
      videoDone.body?.media?.status === 'READY' && videoDone.body.media.durationSec === 7,
      '5b. Video verified (READY, 1080×1920, 7 s read from the file)',
      `status ${videoDone.body?.media?.status}`,
    );
    const videoFinal = await onDisk(alice.ws, videoId, 'workspaces');
    const videoFinalBytes = videoFinal[0]
      ? await readFile(path.join(root, videoFinal[0].file))
      : null;
    check(
      videoFinalBytes && sha(videoFinalBytes) === sha(video.bytes),
      '4b. Video is on disk under workspaces\\ with identical content',
      `${videoFinal[0]?.file} (${videoFinal[0]?.size} bytes)`,
    );

    // A file whose content is not what it claims is rejected and removed.
    const fake = {
      name: 'fake.jpg',
      kind: 'IMAGE',
      type: 'image/jpeg',
      bytes: Buffer.from('<html>not an image</html>'),
    };
    const fakeSlot = await slot(alice, fake);
    await put(fakeSlot.body.upload, fake.bytes);
    const fakeDone = await complete(alice, fakeSlot.body.media.id);
    const fakeLeft = (await filesOf(alice.ws)).filter(
      (f) => f.file.split(path.sep).includes(fakeSlot.body.media.id) && f.size > 0,
    );
    check(
      fakeDone.body?.media?.status === 'FAILED' && fakeLeft.length === 0,
      '5c. A file with the wrong content is rejected and removed from disk',
    );

    /* ---- retrieval ---- */
    const fetched = await fetch(absolute(imageDone.body.media.url));
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    check(
      fetched.status === 200 && sha(fetchedBytes) === sha(image.bytes),
      '7. Image retrieved over HTTP with identical content',
      `HTTP ${fetched.status}, ${fetched.headers.get('content-type')}`,
    );

    /* ---- invalid paths ---- */
    const attempts = [
      '/storage/objects/..%2F..%2F.env',
      '/storage/objects/workspaces/..%2F..%2F..%2Fapps%2Fapi%2F.env',
      '/storage/objects/workspaces/%2E%2E/%2E%2E/x.jpg',
      '/storage/objects/..%5C..%5CWindows%5Cwin.ini',
      '/storage/objects/C:%5CWindows%5Cwin.ini',
      '/storage/objects/%2FWindows%2Fwin.ini',
      `/storage/objects/workspaces/${alice.ws}/media/${imageId}/nope.jpg`,
    ];
    const statuses = [];
    for (const attempt of attempts) statuses.push((await fetch(`${base}${attempt}`)).status);
    check(
      statuses.every((s) => s === 404 || s === 400),
      '12c. Path traversal and unknown paths are refused',
      `HTTP ${statuses.join(', ')}`,
    );
    const forged = await fetch(`${base}/storage/uploads/${'A'.repeat(40)}.${'B'.repeat(43)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: image.bytes,
    });
    check(forged.status === 403, '12d. A forged upload link is refused', `HTTP ${forged.status}`);

    /* ---- workspace isolation ---- */
    const cross1 = await call(bob.token, 'GET', `/workspaces/${bob.ws}/media/${imageId}`);
    const cross2 = await call(bob.token, 'GET', `/workspaces/${alice.ws}/media/${imageId}`);
    const cross3 = await call(bob.token, 'DELETE', `/workspaces/${bob.ws}/media/${imageId}`);
    const bobSlot = await slot(bob, image);
    await put(bobSlot.body.upload, image.bytes);
    await complete(bob, bobSlot.body.media.id);
    const bobFiles = await filesOf(bob.ws);
    check(
      cross1.status === 404 && cross2.status === 404 && cross3.status === 404,
      "11a. Another workspace cannot read or delete this workspace's file",
      `HTTP ${cross1.status}, ${cross2.status}, ${cross3.status}`,
    );
    check(
      bobFiles.length > 0 && bobFiles.every((f) => !f.file.includes(alice.ws)),
      '11b. Each workspace has its own folder on disk',
    );

    console.log('\nFiles on disk right now (this run only):');
    for (const ws of created.workspaces) {
      for (const f of await filesOf(ws))
        console.log(`   ${path.join(root, f.file)}  ${f.size} bytes`);
    }
    console.log('');

    /* ---- restart ---- */
    await stopApi(apiProcess);
    const down = await fetch(`${base}/health`).catch(() => null);
    apiProcess = startApi(env);
    await waitForApi(base, apiProcess);
    const afterRestart = await call(alice.token, 'GET', `/workspaces/${alice.ws}/media/${videoId}`);
    const refetched = await fetch(absolute(afterRestart.body?.media?.url ?? `${base}/none`));
    const refetchedBytes = Buffer.from(await refetched.arrayBuffer());
    check(
      down === null &&
        afterRestart.body?.media?.status === 'READY' &&
        sha(refetchedBytes) === sha(video.bytes),
      '9. After stopping and starting the API, the video is still READY and identical',
      `HTTP ${refetched.status}`,
    );
    const postRestart = await slot(alice, image);
    const postPut = await put(postRestart.body.upload, image.bytes);
    const postDone = await complete(alice, postRestart.body.media.id);
    check(
      postPut.status === 200 && postDone.body?.media?.status === 'READY',
      '9b. Uploading works after the restart',
    );

    /* ---- deletion ---- */
    const del = await call(alice.token, 'DELETE', `/workspaces/${alice.ws}/media/${imageId}`);
    const afterDelete = await onDisk(alice.ws, imageId, 'workspaces');
    const gone = await fetch(absolute(imageDone.body.media.url));
    check(
      del.status === 204 && afterDelete.length === 0 && gone.status === 404,
      '8. Deleting removes the file from disk and it is no longer served',
      `HTTP ${del.status}, then ${gone.status}`,
    );

    /* ---- clean-up script ---- */
    // The video is attached to a draft; a second file is left unused; a third is never completed.
    const draft = await call(alice.token, 'POST', `/workspaces/${alice.ws}/content-packages`, {
      caption: 'storage check',
      media: [{ mediaId: videoId }],
    });
    const abandonedSlot = await slot(alice, image);
    await put(abandonedSlot.body.upload, image.bytes);
    const unusedId = postRestart.body.media.id;
    await mongoose.connect(env.MONGODB_URI);
    const assets = mongoose.connection.db.collection('mediaassets');
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await assets.updateMany({}, { $set: { uploadExpiresAt: old } });
    await assets.updateMany({ completedAt: { $exists: true } }, { $set: { completedAt: old } });
    await mongoose.disconnect();
    const cleanup = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/cleanup-media.js'], { cwd: apiDir, env });
      let out = '';
      child.stdout.on('data', (c) => (out += c));
      child.on('exit', (code) => resolve({ code, out: out.trim() }));
    });
    const keptVideo = await onDisk(alice.ws, videoId, 'workspaces');
    const unusedLeft = await onDisk(alice.ws, unusedId, 'workspaces');
    const abandonedLeft = (await filesOf(alice.ws)).filter((f) =>
      f.file.split(path.sep).includes(abandonedSlot.body.media.id),
    );
    check(
      cleanup.code === 0 && unusedLeft.length === 0 && abandonedLeft.length === 0,
      '10a. Clean-up removed the unused file and the abandoned upload from disk',
      cleanup.out,
    );
    check(
      draft.status === 201 && keptVideo.length === 1,
      '10b. Clean-up kept the file that a draft uses',
    );

    /* ---- remove what this run created ---- */
    await call(
      alice.token,
      'DELETE',
      `/workspaces/${alice.ws}/content-packages/${draft.body.contentPackage.id}`,
    );
    await call(alice.token, 'DELETE', `/workspaces/${alice.ws}/media/${videoId}`);
    await call(bob.token, 'DELETE', `/workspaces/${bob.ws}/media/${bobSlot.body.media.id}`);
  } finally {
    await stopApi(apiProcess);
    await mongoose.disconnect().catch(() => {});
    await mongo.stop();
    // Leftovers of this run only (empty tombstones and folders named after its workspaces).
    const { rm } = await import('node:fs/promises');
    for (const ws of created.workspaces) {
      for (const area of ['uploads', 'workspaces']) {
        const dir = path.join(root, area, ws);
        for (const f of await listFiles(dir)) {
          await rm(path.join(dir, f.file), { force: true });
          await pruneEmpty(path.dirname(path.join(dir, f.file)), path.join(root, area));
        }
        await pruneEmpty(dir, root);
      }
    }
  }

  const after = await listFiles(root);
  const key = (list) =>
    list
      .map((f) => `${f.file}:${f.size}`)
      .sort()
      .join('|');
  check(
    key(before) === key(after),
    'Files that were there before this check are unchanged',
    `${before.length} before, ${after.length} after`,
  );
}

await main().catch((err) => {
  check(false, 'Check aborted', err.message);
});
const failed = results.filter((ok) => !ok).length;
if (results.length) {
  console.log(
    `\n${failed === 0 ? 'All checks passed' : `${failed} check(s) FAILED`} (${results.length - failed} passed).`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
