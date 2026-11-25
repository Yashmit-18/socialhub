// READ-ONLY diagnostics for "Connect Facebook / Instagram": what SocialHub sends to Meta, and
// what happened to each recent attempt. Writes nothing. Prints no state, cookie, code, token or
// secret: an attempt is identified by the first 12 characters of its state's SHA-256 digest,
// the same id the API logs ("Meta OAuth started" / "Meta OAuth callback ...").
//
//   npm run meta:oauth-attempts -w @socialhub/api            (last 20 attempts)
//   npm run meta:oauth-attempts -w @socialhub/api -- 50      (last 50)
//
// Attempts are kept until one hour after they expire (10 minutes after they start).
import { config } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';
import {
  facebookAuthorizationUrl,
  isFacebookConfigured,
} from '../src/integrations/meta/facebook.js';
import { OAuthState, User, Workspace } from '../src/models/index.js';
import {
  describeAuthorizationRequest,
  explainOAuthAttempt,
  oauthAttemptId,
} from '../src/modules/meta/metaOAuth.service.js';

const limit = Math.min(Math.max(Number(process.argv[2]) || 20, 1), 200);

await connectDatabase(config.mongo.uri, { autoIndex: false });
try {
  console.log('What SocialHub sends to Facebook Login now:');
  if (isFacebookConfigured()) {
    const request = describeAuthorizationRequest(
      facebookAuthorizationUrl({ state: 'not-a-real-state' }),
    );
    for (const [key, value] of Object.entries(request)) {
      console.log(`  ${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
  } else {
    console.log('  Facebook Login is not configured (META_APP_ID / META_APP_SECRET).');
  }

  const attempts = await OAuthState.find().sort({ createdAt: -1 }).limit(limit).lean();
  console.log(`\nRecent connect attempts (newest first): ${attempts.length}`);
  for (const attempt of attempts) {
    const [user, workspace] = await Promise.all([
      User.findById(attempt.user).select('name').lean(),
      Workspace.findById(attempt.workspace).select('slug').lean(),
    ]);
    console.log(
      `- ${attempt.createdAt.toISOString()} attempt ${oauthAttemptId(attempt.stateHash)} ${attempt.provider}/${attempt.purpose} by "${user?.name ?? 'unknown'}" in ${workspace?.slug ?? 'unknown'}`,
    );
    console.log(
      `    ${explainOAuthAttempt(attempt)}${attempt.callbackCount > 1 ? ` (${attempt.callbackCount} callbacks)` : ''}`,
    );
  }
} finally {
  await disconnectDatabase();
}
