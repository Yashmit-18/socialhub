// Re-encrypts every stored Meta access token with a new TOKEN_ENCRYPTION_KEY.
//
// 1. npm run secrets                       copy the printed TOKEN_ENCRYPTION_KEY value
// 2. In apps/api/.env add NEW_TOKEN_ENCRYPTION_KEY=<that value> (keep TOKEN_ENCRYPTION_KEY).
// 3. Stop the API (stop-socialhub.cmd).
// 4. npm run secrets:rotate-key -w @socialhub/api                dry run: what would change
// 5. npm run secrets:rotate-key -w @socialhub/api -- --apply     re-encrypts
// 6. In .env set TOKEN_ENCRYPTION_KEY to the new value and delete NEW_TOKEN_ENCRYPTION_KEY.
// 7. Start the API again and run npm run meta:verify -w @socialhub/api -- --live.
//
// Nothing is written unless every token can be read; no key or token is printed. Take a
// backup first (npm run db:backup) and keep the old key until the API works with the new one.
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { parseEncryptionKey, rotateTokenKey } from '../src/maintenance/tokenKeyRotation.js';

const apply = process.argv.includes('--apply');
let newKey;
try {
  newKey = parseEncryptionKey(process.env.NEW_TOKEN_ENCRYPTION_KEY, 'NEW_TOKEN_ENCRYPTION_KEY');
} catch (err) {
  console.error(
    `${err.message}\nAdd NEW_TOKEN_ENCRYPTION_KEY to apps/api/.env first (see the steps at the top of this script).`,
  );
  process.exit(64);
}

if (apply) {
  // A running API keeps encrypting with the old key, which would undo part of the rotation.
  const port = process.env.PORT || 4000;
  const running = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
    signal: AbortSignal.timeout(3000),
  }).then(
    () => true,
    () => false,
  );
  if (running) {
    console.error(
      `The API is running on port ${port}. Stop it first (stop-socialhub.cmd), then run this again.`,
    );
    process.exit(2);
  }
}

await connectDatabase(config.mongo.uri, { autoIndex: false });
try {
  const report = await rotateTokenKey({ currentKey: config.tokenEncryptionKey, newKey, apply });
  console.log(apply ? 'Key rotation (applied):' : 'Key rotation (dry run, nothing written):');
  for (const [model, c] of Object.entries(report.models)) {
    console.log(
      `  ${model}: ${c.tokens} tokens; to rotate ${c.toRotate}; already on the new key ${c.alreadyNewKey}; unreadable ${c.unreadable}` +
        (apply
          ? `; rotated ${c.rotated}; changed meanwhile ${c.changedMeanwhile}; verified with the new key ${c.verifiedWithNewKey}`
          : ''),
    );
    if (c.unreadableIds.length) console.log(`    unreadable ids: ${c.unreadableIds.join(', ')}`);
  }
  if (!apply) {
    console.log(
      report.unreadable
        ? '\nFix the unreadable tokens (reconnect them) before applying.'
        : '\nRun again with --apply to re-encrypt.',
    );
  } else {
    console.log(
      '\nDone. Now set TOKEN_ENCRYPTION_KEY to the new value in .env, remove NEW_TOKEN_ENCRYPTION_KEY, and start the API.',
    );
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
