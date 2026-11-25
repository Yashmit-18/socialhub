// Backs up SocialHub's MongoDB database (MONGODB_URI) into a new dated folder.
//
//   npm run db:backup -w @socialhub/api                  database only
//   npm run db:backup -w @socialhub/api -- --with-media  also copies STORAGE_LOCAL_DIR
//
// Folder: BACKUP_DIR (default apps/api/backups, which git ignores)/socialhub-<date>-<time>.
// Read-only for the database. The backup holds password hashes and encrypted Meta tokens:
// keep it private, and keep TOKEN_ENCRYPTION_KEY too (restored tokens need the same key).
import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { backupDatabase } from '../src/maintenance/databaseBackup.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withMedia = process.argv.includes('--with-media');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const root = path.resolve(apiDir, process.env.BACKUP_DIR || 'backups');
const dir = path.join(root, `socialhub-${stamp}`);

await connectDatabase(config.mongo.uri, { autoIndex: false });
try {
  const manifest = await backupDatabase(mongoose.connection.db, dir);
  const total = manifest.collections.reduce((sum, c) => sum + c.count, 0);
  console.log(
    `Database "${manifest.database}": ${manifest.collections.length} collections, ${total} documents.`,
  );
  for (const c of manifest.collections) console.log(`  ${c.name}: ${c.count}`);

  if (withMedia) {
    const storageDir = process.env.STORAGE_LOCAL_DIR
      ? path.resolve(apiDir, process.env.STORAGE_LOCAL_DIR)
      : null;
    if (process.env.STORAGE_DRIVER !== 'local' || !storageDir) {
      console.log(
        'Media: not copied (STORAGE_DRIVER is not "local"; back up the bucket with its own tools).',
      );
    } else {
      const inside = (p) => p === root || p.startsWith(`${root}${path.sep}`);
      await cp(storageDir, path.join(dir, 'media'), {
        recursive: true,
        // Never copy the backups folder into itself when it lives inside the media folder.
        filter: (source) => !inside(path.resolve(source)),
      });
      console.log(
        `Media: copied from ${storageDir} (${(await readdir(path.join(dir, 'media'))).length} top-level entries).`,
      );
    }
  }
  console.log(`\nBackup written to ${dir}`);
  console.log('It contains password hashes and encrypted Meta tokens: keep it private.');
  console.log('Restoring the tokens needs the same TOKEN_ENCRYPTION_KEY, so keep a copy of it.');
} finally {
  await disconnectDatabase();
}
