import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

// Unknown filter paths are dropped. Operator injection is prevented upstream: every request
// body, query and param passes a strict Zod schema that only admits primitive values.
mongoose.set('strictQuery', true);

let transactionsSupported = false;

/**
 * Multi-document transactions require a replica set or sharded cluster (Atlas, or the
 * docker-compose setup). On a standalone server we fall back to ordered writes with
 * compensating actions, and log a warning once at startup.
 */
async function detectTransactionSupport() {
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    return false;
  }
}

export async function connectDatabase(uri, { autoIndex = true, dbName } = {}) {
  await mongoose.connect(uri, {
    autoIndex,
    dbName,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  transactionsSupported = await detectTransactionSupport();
  if (!transactionsSupported) {
    logger.warn(
      'MongoDB is running without replica set support; multi-document operations will not be transactional.',
    );
  }
  logger.info({ db: mongoose.connection.name, transactionsSupported }, 'MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function isTransactionSupported() {
  return transactionsSupported;
}

/** Test hook: lets tests exercise the non-transactional fallback path. */
export function setTransactionSupportForTests(value) {
  transactionsSupported = value;
}

export function databaseState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] ?? 'unknown';
}

/**
 * Run `fn(session)` inside a transaction when supported, otherwise run it with `session = null`.
 * Callers must pass `{ session }` to every query; Mongoose treats `session: null` as no session.
 */
export async function runInTransaction(fn) {
  if (!transactionsSupported) return fn(null);
  let result;
  await mongoose.connection.transaction(async (session) => {
    result = await fn(session);
  });
  return result;
}
