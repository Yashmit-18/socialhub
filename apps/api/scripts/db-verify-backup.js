// Checks a backup folder against its manifest (document counts and SHA-256 of every file).
// Touches no database.  npm run db:verify-backup -w @socialhub/api -- <backup folder>
import path from 'node:path';
import { readManifest, verifyBackup } from '../src/maintenance/databaseBackup.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npm run db:verify-backup -w @socialhub/api -- <backup folder>');
  process.exit(64);
}
const folder = path.resolve(dir);
const manifest = await readManifest(folder);
const problems = await verifyBackup(folder);
console.log(
  `Backup of "${manifest.database}" made ${manifest.createdAt}: ${manifest.collections.length} collections.`,
);
if (problems.length === 0) {
  console.log('Intact: every file matches its document count and checksum.');
} else {
  console.log(`DAMAGED:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
