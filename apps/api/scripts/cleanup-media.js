/**
 * Removes abandoned uploads and stored files that no draft uses.
 *
 *   npm run media:cleanup -w @socialhub/api
 *
 * Run it on a schedule (for example hourly from cron) until the BullMQ worker takes over.
 * It only deletes: upload slots that expired more than an hour ago without being completed,
 * and verified or failed files older than 24 hours that no draft references.
 */
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { cleanupMedia } from '../src/modules/media/media.service.js';
import { getStorage } from '../src/storage/index.js';

async function main() {
  await connectDatabase(config.mongo.uri, { autoIndex: false });
  if (!getStorage()) {
    console.log('Media storage is not configured (STORAGE_DRIVER); only records are removed.');
  }
  const result = await cleanupMedia();
  console.log(
    `Media clean-up: ${result.abandoned} abandoned upload(s), ${result.unreferenced} unused file(s) and ${result.uploadObjects} leftover upload object(s) removed, ${result.failed} failed.`,
  );
  await disconnectDatabase();
  process.exitCode = result.failed > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error('Media clean-up failed:', err.message);
  await disconnectDatabase().catch(() => {});
  process.exitCode = 1;
});
