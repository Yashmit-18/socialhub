/**
 * Backups of SocialHub's MongoDB database (`npm run db:backup` / `db:verify-backup` /
 * `db:restore`, apps/api).
 *
 * A backup is a folder with one `<collection>.jsonl` file per collection (Extended JSON, one
 * document per line, so ObjectIds and dates survive exactly) and a `manifest.json` listing each
 * file's document count and SHA-256. Restoring checks every file against the manifest first and
 * only ever writes into collections that are empty, so it can never overwrite live data.
 *
 * A backup contains what the database contains: password hashes, hashed session tokens and
 * Meta access tokens encrypted with TOKEN_ENCRYPTION_KEY (restoring them needs the same key).
 * Keep backups private.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import { finished } from 'node:stream/promises';
import mongoose from 'mongoose';

const { EJSON } = mongoose.mongo.BSON;

export const BACKUP_FORMAT = 'socialhub-backup';
const INSERT_BATCH = 500;

async function collectionNames(db) {
  const all = await db.listCollections({}, { nameOnly: true }).toArray();
  return all
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();
}

/** Writes every collection of `db` into `dir` and returns the manifest. */
export async function backupDatabase(db, dir) {
  await mkdir(dir, { recursive: true });
  const manifest = {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    database: db.databaseName,
    collections: [],
  };
  for (const name of await collectionNames(db)) {
    const file = `${name}.jsonl`;
    const hash = createHash('sha256');
    const out = createWriteStream(path.join(dir, file), { encoding: 'utf8' });
    let count = 0;
    for await (const doc of db.collection(name).find({})) {
      const line = `${EJSON.stringify(doc, { relaxed: false })}\n`;
      hash.update(line);
      count += 1;
      if (!out.write(line)) await once(out, 'drain');
    }
    out.end();
    await finished(out);
    manifest.collections.push({ name, file, count, sha256: hash.digest('hex') });
  }
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readManifest(dir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.collections)) {
    throw new Error(`${dir} is not a SocialHub backup (manifest.json missing or wrong format).`);
  }
  for (const entry of manifest.collections) {
    // The file name comes from the manifest: never let it point outside the backup folder.
    if (path.basename(entry.file) !== entry.file || !entry.file.endsWith('.jsonl')) {
      throw new Error(`Unexpected file name in manifest: ${entry.file}`);
    }
  }
  return manifest;
}

async function* lines(file) {
  const reader = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) if (line.length > 0) yield line;
}

/** Recomputes every file's count and SHA-256. Returns a list of problems (empty = intact). */
export async function verifyBackup(dir) {
  const manifest = await readManifest(dir);
  const problems = [];
  for (const entry of manifest.collections) {
    const hash = createHash('sha256');
    let count = 0;
    try {
      for await (const line of lines(path.join(dir, entry.file))) {
        hash.update(`${line}\n`);
        count += 1;
      }
    } catch (err) {
      problems.push(`${entry.file}: cannot be read (${err.code ?? err.message})`);
      continue;
    }
    if (count !== entry.count)
      problems.push(`${entry.file}: ${count} documents, manifest says ${entry.count}`);
    if (hash.digest('hex') !== entry.sha256)
      problems.push(`${entry.file}: checksum does not match`);
  }
  return problems;
}

/**
 * Restores a verified backup into `db`. Refuses (writing nothing) when the backup is damaged
 * or when any collection it would write to already has documents.
 */
export async function restoreDatabase(db, dir) {
  const manifest = await readManifest(dir);
  const problems = await verifyBackup(dir);
  if (problems.length > 0) {
    throw new Error(`The backup is damaged; nothing was restored:\n- ${problems.join('\n- ')}`);
  }
  const notEmpty = [];
  for (const entry of manifest.collections) {
    if ((await db.collection(entry.name).countDocuments({}, { limit: 1 })) > 0) {
      notEmpty.push(entry.name);
    }
  }
  if (notEmpty.length > 0) {
    throw new Error(
      `Refusing to restore into a database that already has data (${notEmpty.join(', ')}). Restore into an empty database.`,
    );
  }
  const restored = {};
  for (const entry of manifest.collections) {
    let batch = [];
    let count = 0;
    for await (const line of lines(path.join(dir, entry.file))) {
      batch.push(EJSON.parse(line, { relaxed: false }));
      if (batch.length === INSERT_BATCH) {
        await db.collection(entry.name).insertMany(batch, { ordered: true });
        count += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await db.collection(entry.name).insertMany(batch, { ordered: true });
      count += batch.length;
    }
    restored[entry.name] = count;
  }
  return { manifest, restored };
}
