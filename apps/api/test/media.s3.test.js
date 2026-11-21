import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog, MediaAsset } from '../src/models/index.js';
import { cleanupMedia } from '../src/modules/media/media.service.js';
import { setStorageForTests } from '../src/storage/index.js';
import { createS3Storage } from '../src/storage/s3Storage.js';
import { as, createWorkspace, registerUser, seedTeam } from './helpers.js';
import { createFakeS3, gifBytes, jpegBytes, mediaUrl, requestSlot } from './mediaFixtures.js';

/**
 * SIMULATED S3. These tests run the real S3 driver (src/storage/s3Storage.js) and the real
 * media endpoints against `createFakeS3`, an in-process stand-in that validates SigV4
 * signatures and link expiry and overwrites on PUT like S3 does.
 *
 * They prove the API's logic: a verified file cannot be changed through its upload link.
 * They do NOT prove anything about a real bucket. For that, run
 * `npm run storage:verify -w @socialhub/api` against the configured bucket
 * (see docs/COMPOSER_API_CONTRACT.md → "Verifying a real bucket").
 */

let team;
let ws;
let s3;

const complete = (token, id, workspaceId = ws) =>
  as(token).post(mediaUrl(workspaceId, `/${id}/complete`));

/** Asks the API for an upload slot. Returns { id, upload, asset }. */
async function slot(bytes = jpegBytes(), body = {}) {
  const res = await requestSlot(team.editor.token, ws, {
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    kind: 'IMAGE',
    sizeBytes: bytes.length,
    ...body,
  });
  expect(res.status).toBe(201);
  return {
    id: res.body.media.id,
    upload: res.body.upload,
    asset: await MediaAsset.findById(res.body.media.id),
  };
}

/** Slot → browser PUT → complete. Returns everything, with the READY media. */
async function uploadAndComplete(bytes = jpegBytes()) {
  const made = await slot(bytes);
  expect((await s3.browserPut(made.upload, bytes)).status).toBe(200);
  const done = await complete(team.editor.token, made.id);
  expect(done.body.media.status).toBe('READY');
  return { ...made, media: done.body.media };
}

/** Bytes of the same length as `bytes`, but different content. */
const sameSizeOther = (bytes) => Buffer.alloc(bytes.length, 0x41);

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  s3 = createFakeS3();
  setStorageForTests(
    createS3Storage({
      ...s3.settings,
      publicBaseUrl: 'https://cdn.example.test',
      fetchImpl: s3.fetch,
    }),
  );
});
afterEach(() => setStorageForTests(undefined));

describe('S3 uploads (simulated provider): the upload link and the verified file', () => {
  it('1. accepts the first authorized upload and verifies it', async () => {
    const bytes = jpegBytes(1080, 1350);
    const { asset, media, upload } = await uploadAndComplete(bytes);

    expect(media).toMatchObject({ status: 'READY', width: 1080, height: 1350 });
    // The link was signed for the upload key only; the file now lives at another key.
    expect(new URL(upload.url).pathname).toBe(`/media/${asset.uploadKey}`);
    expect(asset.uploadKey).not.toBe(asset.storageKey);
    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
    expect(media.url).toBe(`https://cdn.example.test/${asset.storageKey}`);
    // The upload object is gone once its content has been copied.
    expect(s3.bytesAt(asset.uploadKey)).toBeNull();
  });

  it('2. a repeated upload cannot overwrite the verified object', async () => {
    const bytes = jpegBytes();
    const { asset, upload, id } = await uploadAndComplete(bytes);

    // S3 itself accepts the repeated PUT (the link is still valid)…
    expect((await s3.browserPut(upload, bytes)).status).toBe(200);
    // …but it can only write the upload key. Nothing ever writes the final key again.
    const writesToFinal = s3.log.filter((r) => r.method === 'PUT' && r.key === asset.storageKey);
    expect(writesToFinal).toHaveLength(1);
    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
    expect((await MediaAsset.findById(id)).status).toBe('READY');
  });

  it('3. an altered file of the same size cannot replace the original', async () => {
    const bytes = jpegBytes(1080, 1350);
    const { asset, upload, id, media } = await uploadAndComplete(bytes);

    expect((await s3.browserPut(upload, sameSizeOther(bytes))).status).toBe(200);
    // Completing again must not pull the altered bytes in.
    const again = await complete(team.editor.token, id);
    expect(again.status).toBe(200);
    expect(again.body.media).toEqual(media);

    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
    const copies = s3.log.filter((r) => r.method === 'PUT' && r.key === asset.storageKey);
    expect(copies).toHaveLength(1);
    expect(await ActivityLog.countDocuments({ action: 'media.uploaded' })).toBe(1);
  });

  it('3b. the link cannot be pointed at the final key, or at any other key', async () => {
    const bytes = jpegBytes();
    const { asset, upload } = await uploadAndComplete(bytes);
    const other = await uploadAndComplete(jpegBytes(640, 480));

    for (const target of [asset.storageKey, other.asset.storageKey, other.asset.uploadKey]) {
      const forged = new URL(upload.url);
      forged.pathname = `/media/${target}`;
      const res = await s3.browserPut({ ...upload, url: forged.toString() }, sameSizeOther(bytes));
      expect(res.status).toBe(403); // the signature covers the path
    }
    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
  });

  it('3c. the link cannot carry a different type or size', async () => {
    const bytes = jpegBytes();
    const made = await slot(bytes);
    const wrongType = await s3.browserPut(made.upload, bytes, { 'Content-Type': 'text/html' });
    expect(wrongType.status).toBe(403);
    const wrongSize = await s3.browserPut(made.upload, Buffer.concat([bytes, bytes]));
    expect(wrongSize.status).toBe(403);
    expect(s3.objects.size).toBe(0);
  });

  it('4. an expired link cannot modify anything, before or after completion', async () => {
    const bytes = jpegBytes();
    const { asset, upload } = await uploadAndComplete(bytes);

    s3.state.now = new Date(Date.now() + 16 * 60_000); // past the 15-minute lifetime
    const late = await s3.browserPut(upload, sameSizeOther(bytes));
    expect(late.status).toBe(403);
    expect(s3.bytesAt(asset.uploadKey)).toBeNull();
    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
  });

  it('5. completion verifies the bytes that are actually stored, not what was announced', async () => {
    // Announced as a JPEG; the bytes are a GIF padded to the same length.
    const announced = jpegBytes();
    const actual = Buffer.concat([gifBytes(), Buffer.alloc(announced.length - gifBytes().length)]);
    const made = await slot(announced);
    expect((await s3.browserPut(made.upload, actual)).status).toBe(200);

    const res = await complete(team.editor.token, made.id);
    expect(res.body.media).toMatchObject({
      status: 'FAILED',
      url: null,
      failureReason: 'The file content does not match its type.',
    });
  });

  it('5b. verifies the copy at the final key, so a swap during completion cannot slip through', async () => {
    const good = jpegBytes(1080, 1350);
    const made = await slot(good);
    await s3.browserPut(made.upload, good);

    // The moment the API has copied the upload, the attacker replaces the upload object.
    let swapped = false;
    s3.state.beforeRequest = async ({ method, key }) => {
      if (!swapped && method === 'HEAD' && key === made.asset.storageKey) {
        swapped = true;
        s3.state.beforeRequest = null;
        await s3.browserPut(made.upload, sameSizeOther(good));
      }
    };
    const res = await complete(team.editor.token, made.id);

    expect(swapped).toBe(true);
    // What was verified and marked READY is the copy, which the swap could not reach.
    expect(res.body.media).toMatchObject({ status: 'READY', width: 1080, height: 1350 });
    expect(Buffer.compare(s3.bytesAt(made.asset.storageKey), good)).toBe(0);
  });

  it('5c. if the swap lands before the copy, the swapped bytes are what gets judged', async () => {
    const good = jpegBytes();
    const made = await slot(good);
    await s3.browserPut(made.upload, good);
    await s3.browserPut(made.upload, sameSizeOther(good)); // replaced before completion

    const res = await complete(team.editor.token, made.id);
    // Never "READY with unverified content": the junk is rejected and removed.
    expect(res.body.media.status).toBe('FAILED');
    expect(s3.objects.size).toBe(0);
  });

  it('6. failed verification removes the invalid object under both keys', async () => {
    const bytes = sameSizeOther(jpegBytes());
    const made = await slot(bytes);
    await s3.browserPut(made.upload, bytes);

    const res = await complete(team.editor.token, made.id);
    expect(res.body.media.status).toBe('FAILED');
    expect(s3.bytesAt(made.asset.uploadKey)).toBeNull();
    expect(s3.bytesAt(made.asset.storageKey)).toBeNull();
    expect(s3.objects.size).toBe(0);

    // The outcome is final: completing again does not revive it, even after a re-upload.
    await s3.browserPut(made.upload, jpegBytes());
    const again = await complete(team.editor.token, made.id);
    expect(again.body.media.status).toBe('FAILED');
    expect(s3.bytesAt(made.asset.storageKey)).toBeNull();
  });

  it('7. simultaneous completion requests leave one consistent result', async () => {
    const bytes = jpegBytes();
    const made = await slot(bytes);
    await s3.browserPut(made.upload, bytes);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => complete(team.editor.token, made.id)),
    );
    // Each answer is either the READY asset or "being verified, try again": never an error,
    // never a second verification.
    for (const res of results) {
      expect([200, 409]).toContain(res.status);
      if (res.status === 200) expect(res.body.media.status).toBe('READY');
      else expect(res.body.error.code).toBe('CONFLICT');
    }
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(
      s3.log.filter((r) => r.method === 'PUT' && r.key === made.asset.storageKey),
    ).toHaveLength(1);
    expect(await ActivityLog.countDocuments({ action: 'media.uploaded' })).toBe(1);
    const stored = await MediaAsset.findById(made.id);
    expect(stored.status).toBe('READY');
    expect(stored.verifyingAt).toBeUndefined();
  });

  it('7b. completing while the upload is still in flight is "not arrived", and retryable', async () => {
    const bytes = jpegBytes();
    const made = await slot(bytes);

    const early = await complete(team.editor.token, made.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('UPLOAD_INCOMPLETE');
    const pending = await MediaAsset.findById(made.id);
    expect(pending.status).toBe('PENDING_UPLOAD');
    expect(pending.verifyingAt).toBeUndefined(); // the claim was released

    await s3.browserPut(made.upload, bytes);
    expect((await complete(team.editor.token, made.id)).body.media.status).toBe('READY');
  });

  it('7c. a storage outage during completion leaves the upload pending and retryable', async () => {
    const bytes = jpegBytes();
    const made = await slot(bytes);
    await s3.browserPut(made.upload, bytes);

    // The provider fails right after the copy, in the middle of verification.
    s3.state.beforeRequest = async ({ method, key }) => {
      if (method === 'GET' && key === made.asset.storageKey) throw new Error('ECONNRESET');
    };
    const res = await complete(team.editor.token, made.id);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect((await MediaAsset.findById(made.id)).status).toBe('PENDING_UPLOAD');

    s3.state.beforeRequest = null;
    const retry = await complete(team.editor.token, made.id);
    expect(retry.body.media.status).toBe('READY');
    expect(Buffer.compare(s3.bytesAt(made.asset.storageKey), bytes)).toBe(0);
  });

  it('takes over a claim left behind by a crashed request', async () => {
    const bytes = jpegBytes();
    const made = await slot(bytes);
    await s3.browserPut(made.upload, bytes);
    await MediaAsset.updateOne({ _id: made.id }, { verifyingAt: new Date() });
    expect((await complete(team.editor.token, made.id)).status).toBe(409);

    await MediaAsset.updateOne(
      { _id: made.id },
      { verifyingAt: new Date(Date.now() - 3 * 60_000) },
    );
    expect((await complete(team.editor.token, made.id)).body.media.status).toBe('READY');
  });
});

describe('S3 uploads (simulated provider): isolation and clean-up', () => {
  it('does not let another member or another workspace touch a verified file', async () => {
    const bytes = jpegBytes();
    const { asset, id } = await uploadAndComplete(bytes);
    const outsider = await registerUser();
    const { workspace: otherWs } = await createWorkspace(outsider.token, { name: 'Other' });

    expect((await complete(outsider.token, id)).status).toBe(404);
    expect((await complete(outsider.token, id, otherWs.id)).status).toBe(404);
    expect((await as(outsider.token).delete(mediaUrl(otherWs.id, `/${id}`))).status).toBe(404);
    expect((await complete(team.viewer.token, id)).status).toBe(403);
    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
  });

  it('keeps every key inside its own workspace prefix and never lists the bucket', async () => {
    const { asset } = await uploadAndComplete();
    expect(asset.storageKey.startsWith(`workspaces/${ws}/media/${asset.id}/`)).toBe(true);
    expect(asset.uploadKey.startsWith(`uploads/${ws}/${asset.id}/`)).toBe(true);
    // Every request names one object key: the driver has no listing call.
    expect(s3.log.every((r) => r.key.length > 0 && !r.key.endsWith('/'))).toBe(true);
  });

  it('removes an object left behind by a reused link once the link has expired', async () => {
    const bytes = jpegBytes();
    const { asset, upload, id } = await uploadAndComplete(bytes);
    await s3.browserPut(upload, sameSizeOther(bytes)); // leftover at the upload key
    expect(s3.bytesAt(asset.uploadKey)).not.toBeNull();

    // While the link is still valid the leftover is kept (it could be written again anyway).
    expect((await cleanupMedia({ now: new Date() })).uploadObjects).toBe(0);
    const result = await cleanupMedia({ now: new Date(Date.now() + 16 * 60_000) });
    expect(result).toMatchObject({ uploadObjects: 1, failed: 0 });
    expect(s3.bytesAt(asset.uploadKey)).toBeNull();
    expect(Buffer.compare(s3.bytesAt(asset.storageKey), bytes)).toBe(0);
    expect((await MediaAsset.findById(id)).uploadKey).toBeUndefined();
  });

  it('removes both objects of an abandoned upload and of a deleted file', async () => {
    const bytes = jpegBytes();
    const abandoned = await slot(bytes);
    await s3.browserPut(abandoned.upload, bytes); // uploaded, never completed
    const kept = await uploadAndComplete(bytes);

    await cleanupMedia({ now: new Date(Date.now() + 3 * 60 * 60_000) });
    expect(await MediaAsset.findById(abandoned.id)).toBeNull();
    expect(s3.bytesAt(abandoned.asset.uploadKey)).toBeNull();

    expect((await as(team.editor.token).delete(mediaUrl(ws, `/${kept.id}`))).status).toBe(204);
    expect(s3.objects.size).toBe(0);
  });

  it('never exposes either key or the credentials in an API answer', async () => {
    const { id, asset, upload } = await uploadAndComplete();
    const read = await as(team.editor.token).get(mediaUrl(ws, `/${id}`));
    const text = JSON.stringify(read.body) + JSON.stringify(upload);
    expect(text).not.toContain('TESTSECRET');
    expect(JSON.stringify(read.body)).not.toContain(asset.uploadKey);
    expect(JSON.stringify(read.body)).not.toContain('uploadKey');
    expect(JSON.stringify(read.body)).not.toContain('verifyingAt');
  });
});
