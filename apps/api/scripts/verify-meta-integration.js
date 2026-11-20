// Read-only verification of the Meta integration against real data.
//   npm run meta:verify -w @socialhub/api -- [--workspace <slug>] [--live] [--log <file>]...
// --live   re-validates stored tokens with Meta (debug_token, /me/accounts, Instagram /me; read-only)
// --log    scans a captured server log for tokens and secrets (repeatable)
// Never writes to the database and never prints tokens. Exit code 1 if any item FAILs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import { verifyMetaIntegration } from '../src/modules/meta/metaVerification.service.js';

const args = process.argv.slice(2);
const options = { live: false, logs: [] };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--workspace') options.workspaceSlug = args[(i += 1)];
  else if (args[i] === '--log') {
    const file = args[(i += 1)];
    options.logs.push({ name: path.basename(file), text: readFileSync(file, 'utf8') });
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(2);
  }
}

// A failed database connection should be reported plainly, not as a crash (no URI in output).
process.on('unhandledRejection', (err) => {
  console.error(`Verification aborted: ${err?.name ?? 'Error'}: ${err?.message ?? err}`);
  process.exit(2);
});

let report;
try {
  await connectDatabase(config.mongo.uri, { autoIndex: false });
  report = await verifyMetaIntegration(options);
} catch (err) {
  console.error(`Verification aborted: ${err.name}: ${err.message}`);
  console.error(
    'Check MONGODB_URI, network access and (for Atlas) the IP access list, then retry.',
  );
  process.exit(2);
} finally {
  await disconnectDatabase().catch(() => {});
}

const ICON = { PASS: 'PASS   ', FAIL: 'FAIL   ', PENDING: 'PENDING', BLOCKED: 'BLOCKED' };
console.log(`\nSocialHub Meta integration verification — ${new Date().toISOString()}`);
console.log(
  `Live Meta checks: ${report.live ? 'ON' : 'off (add --live)'} · Logs scanned: ${report.logsScanned.join(', ') || 'none (add --log <file>)'}`,
);
console.log(`Inventory: ${JSON.stringify(report.inventory)}\n`);
for (const r of report.results) {
  console.log(`${ICON[r.status]}  ${String(r.item).padStart(2)}. ${r.title}`);
  for (const line of r.evidence) console.log(`             - ${line}`);
}
const counts = report.results.reduce(
  (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
  {},
);
console.log(
  `\nSummary: ${Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')}`,
);
console.log(
  'Phase 2 may be marked complete only when items 4–15 are PASS with --live and a scanned log.\n',
);
process.exit(report.results.some((r) => r.status === 'FAIL') ? 1 : 0);
