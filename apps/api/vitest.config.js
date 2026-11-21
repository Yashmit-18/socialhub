import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.js'],
    setupFiles: ['./test/setup.js'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-0123456789',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      BCRYPT_ROUNDS: '4',
      CLIENT_ORIGIN: 'http://localhost:5173',
      AUTH_RATE_LIMIT_MAX: '10000',
      API_RATE_LIMIT_PER_MINUTE: '100000',
      REFRESH_REUSE_GRACE_SECONDS: '5',
      // Test-only Meta app credentials; all Meta traffic in tests goes to the simulated Meta in test/fakeMeta.js.
      API_PUBLIC_URL: 'http://localhost:4000',
      META_APP_ID: '1111111111',
      META_APP_SECRET: 'test-meta-app-secret-0123456789',
      META_GRAPH_API_VERSION: 'v27.0',
      INSTAGRAM_APP_ID: '2222222222',
      INSTAGRAM_APP_SECRET: 'test-instagram-app-secret-0123456789',
      // Media tests use the real local-disk storage driver in a throwaway directory.
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: path.join(os.tmpdir(), `socialhub-test-storage-${process.pid}`),
    },
  },
});
