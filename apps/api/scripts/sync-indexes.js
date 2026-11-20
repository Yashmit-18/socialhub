// Builds/reconciles MongoDB indexes for every model. Run on deploy when MONGODB_AUTO_INDEX=false.
import { config } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import * as models from '../src/models/index.js';

await connectDatabase(config.mongo.uri, { autoIndex: false });
for (const [name, Model] of Object.entries(models)) {
  const dropped = await Model.syncIndexes();
  logger.info({ model: name, dropped }, 'Indexes synchronised');
}
await disconnectDatabase();
