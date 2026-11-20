// Re-validates every active Meta connection: token validity/expiry, granted permissions,
// Instagram token refresh, and each destination's access. Schedule it (e.g. daily via cron)
// until the Phase 4 BullMQ scheduler takes over. Each attempt is recorded as a SyncRun
// (trigger SCHEDULED). Exits non-zero if any sync errored.
import { CONNECTION_STATUS, ERROR_CODES, SYNC_TRIGGERS } from '@socialhub/shared';
import { config } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { SocialConnection } from '../src/models/index.js';
import { syncConnection } from '../src/modules/meta/metaConnection.service.js';

await connectDatabase(config.mongo.uri, { autoIndex: false });

let synced = 0;
let failed = 0;
let skipped = 0;
const cursor = SocialConnection.find({ status: CONNECTION_STATUS.ACTIVE })
  .select('+accessToken')
  .cursor();
for await (const connection of cursor) {
  try {
    const result = await syncConnection(connection, {
      manual: false,
      trigger: SYNC_TRIGGERS.SCHEDULED,
    });
    synced += 1;
    logger.info(
      {
        connectionId: String(connection._id),
        status: result.connection.status,
        accounts: result.accounts,
      },
      'Meta connection synced',
    );
  } catch (err) {
    // Not an error of the connection: the provider is not configured or a sync is running.
    if (err.code === ERROR_CODES.META_NOT_CONFIGURED || err.code === ERROR_CODES.SYNC_IN_PROGRESS) {
      skipped += 1;
      logger.warn({ connectionId: String(connection._id), code: err.code }, 'Meta connection sync skipped');
      continue;
    }
    failed += 1;
    logger.error(
      { connectionId: String(connection._id), code: err.code, message: err.message },
      'Meta connection sync failed',
    );
  }
}

logger.info({ synced, failed, skipped }, 'Meta connection sync finished');
await disconnectDatabase();
process.exit(failed > 0 ? 1 : 0);
