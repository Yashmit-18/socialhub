// Restores a backup made by `npm run db:backup` into an EMPTY database.
//
//   npm run db:restore -w @socialhub/api -- <backup folder>
//
// Target: RESTORE_MONGODB_URI if set, otherwise MONGODB_URI. The backup is verified first, and
// the restore refuses (writing nothing) if any collection it would fill already has documents,
// so it can never overwrite live data. Afterwards run `npm run db:indexes -w @socialhub/api`.
// Media files are not restored automatically: copy the backup's "media" folder back to
// STORAGE_LOCAL_DIR yourself if you need them.
import path from 'node:path';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { restoreDatabase } from '../src/maintenance/databaseBackup.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npm run db:restore -w @socialhub/api -- <backup folder>');
  process.exit(64);
}
const uri = process.env.RESTORE_MONGODB_URI || config.mongo.uri;
// Never print credentials: only the host and database name.
const target = (() => {
  try {
    const parsed = new URL(uri);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparsable URI)';
  }
})();

await connectDatabase(uri, { autoIndex: false });
try {
  console.log(
    `Restoring ${path.resolve(dir)} into ${target} (database "${mongoose.connection.db.databaseName}")...`,
  );
  const { manifest, restored } = await restoreDatabase(mongoose.connection.db, path.resolve(dir));
  for (const entry of manifest.collections) console.log(`  ${entry.name}: ${restored[entry.name]}`);
  console.log('\nRestored. Next: npm run db:indexes -w @socialhub/api');
  console.log(
    'Meta tokens only work with the TOKEN_ENCRYPTION_KEY that was in use when the backup was made.',
  );
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
