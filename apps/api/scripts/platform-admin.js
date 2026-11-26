// Gives, removes or lists platform admin access (the operator console at /admin).
// This is the only way to make someone a platform admin: no web page and no API call can.
//
//   npm run admin:grant  -w @socialhub/api -- person@example.com
//   npm run admin:revoke -w @socialhub/api -- person@example.com
//   npm run admin:list   -w @socialhub/api
//
// On a host without npm scripts: node apps/api/scripts/platform-admin.js grant person@example.com
//
// The person must already have a SocialHub account. The change takes effect on their next
// request; they reload the page to see the "Admin console" entry. Every grant and revoke is
// written to the platform audit log. Prints a name, an email address and an id; reads and
// prints no password, token or session.
import { emailSchema } from '@socialhub/shared';
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import {
  grantPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from '../src/maintenance/platformAdmin.js';

const USAGE = [
  'Gives, removes or lists platform admin access (the operator console at /admin).',
  '',
  '  npm run admin:grant  -w @socialhub/api -- person@example.com',
  '  npm run admin:revoke -w @socialhub/api -- person@example.com',
  '  npm run admin:list   -w @socialhub/api',
  '',
  'On a host without npm scripts: node apps/api/scripts/platform-admin.js grant person@example.com',
].join('\n');
const GRANT_HINT = 'npm run admin:grant -w @socialhub/api -- <email>';

const [command, rawEmail] = process.argv.slice(2);
const parsed = emailSchema.safeParse(rawEmail);
if (!['grant', 'revoke', 'list'].includes(command) || (command !== 'list' && !parsed.success)) {
  console.error(USAGE);
  process.exit(64);
}
const email = parsed.data;
const who = (user) => `${user.name} <${user.email}>`;

await connectDatabase(config.mongo.uri, { autoIndex: false });
try {
  if (command === 'list') {
    const admins = await listPlatformAdmins();
    if (!admins.length) {
      console.log(`There is no platform admin yet. Give access with: ${GRANT_HINT}`);
    } else {
      console.log(`Platform admins (${admins.length}):`);
      for (const admin of admins) console.log(`  ${who(admin)}  id ${admin.id}`);
    }
  } else if (command === 'grant') {
    const { code, user } = await grantPlatformAdmin(email);
    if (code === 'GRANTED') {
      console.log(`Platform admin access given to ${who(user)} (id ${user.id}).`);
      console.log('They reload SocialHub to see "Admin console" in the sidebar.');
    } else if (code === 'ALREADY_ADMIN') {
      console.log(`${who(user)} is already a platform admin. Nothing was changed.`);
    } else if (code === 'SUSPENDED') {
      console.log(`The account of ${who(user)} is suspended. Reactivate it first.`);
      process.exitCode = 1;
    } else {
      console.log(`No SocialHub account uses ${email}. The person has to register first.`);
      process.exitCode = 1;
    }
  } else {
    const { code, user, remaining } = await revokePlatformAdmin(email);
    if (code === 'REVOKED') {
      console.log(`Platform admin access removed from ${who(user)} (id ${user.id}).`);
      console.log(
        remaining
          ? `Platform admins left: ${remaining}.`
          : `No platform admin is left. Give access again with: ${GRANT_HINT}`,
      );
    } else if (code === 'NOT_ADMIN') {
      console.log(`${who(user)} is not a platform admin. Nothing was changed.`);
    } else {
      console.log(`No SocialHub account uses ${email}. The person has to register first.`);
      process.exitCode = 1;
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
