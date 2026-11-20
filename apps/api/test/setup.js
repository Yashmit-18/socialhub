import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import {
  connectDatabase,
  disconnectDatabase,
  setTransactionSupportForTests,
} from '../src/db/mongoose.js';
import { outbox } from '../src/lib/mailer.js';
import * as models from '../src/models/index.js';

beforeAll(async () => {
  await connectDatabase(inject('mongoUri'), {
    dbName: `socialhub_test_${randomUUID().slice(0, 8)}`,
  });
  // Unique/partial indexes are part of the behaviour under test; make sure they exist.
  await Promise.all(Object.values(models).map((Model) => Model.init()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  outbox.length = 0;
  setTransactionSupportForTests(true);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
});
