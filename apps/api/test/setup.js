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

/**
 * No test may reach the real Meta. Tests use a simulated Meta (setMetaTransportForTests); a
 * request that would still go to a Meta host is refused here, before it leaves this computer,
 * and the test that made it fails (afterEach below), even if the code under test treated the
 * refusal as an ordinary outage.
 */
const META_HOST = /(^|\.)(facebook\.com|instagram\.com|fbcdn\.net|fb\.com)$/i;
const blockedMetaRequests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const url = raw ? new URL(raw) : null;
  if (url && META_HOST.test(url.hostname)) {
    const request = `${init?.method ?? 'GET'} ${url.hostname}${url.pathname}`;
    blockedMetaRequests.push(request);
    return Promise.reject(new Error(`A test tried to reach the real Meta: ${request}`));
  }
  return realFetch(input, init);
};

afterEach(() => {
  if (blockedMetaRequests.length) {
    const requests = blockedMetaRequests.splice(0);
    throw new Error(`Real Meta requests were attempted (and blocked): ${requests.join(', ')}`);
  }
});

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
