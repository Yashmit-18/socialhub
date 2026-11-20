/**
 * Meta platform callbacks configured in the App Dashboard:
 *  - Deauthorize: the person removed the app -> their connections become REVOKED, tokens erased.
 *  - Data deletion: the person asked Meta to delete their data -> their connections and the
 *    destinations obtained through them are deleted, and a confirmation code is returned.
 * Both arrive as a `signed_request` verified with the corresponding app secret.
 */
import {
  CONNECTION_STATUS,
  ERROR_CODES,
  SOCIAL_PLATFORMS,
  SOCIAL_PROVIDERS,
} from '@socialhub/shared';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { facebookSettings, instagramSettings } from '../../integrations/meta/settings.js';
import { SignedRequestError, parseSignedRequest } from '../../integrations/meta/signedRequest.js';
import { MetaDataDeletionRequest, SocialAccount, SocialConnection } from '../../models/index.js';
import {
  SYSTEM_ACTORS,
  deleteConnectionAndAccounts,
  revokeConnectionByMeta,
} from './metaConnection.service.js';

/**
 * Secrets a callback may be signed with. Facebook callbacks use the Meta app secret. Meta
 * does not document which secret signs Instagram Login callbacks, so both of SocialHub's
 * own secrets are accepted there (each proves the request came from Meta for this app).
 */
function secretsFor(provider) {
  const fb = facebookSettings()?.appSecret;
  const ig = instagramSettings()?.appSecret;
  return (provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN ? [fb] : [ig, fb]).filter(Boolean);
}

function verify(provider, signedRequest) {
  const secrets = secretsFor(provider);
  const configured =
    provider === SOCIAL_PROVIDERS.FACEBOOK_LOGIN ? facebookSettings() : instagramSettings();
  if (!configured || secrets.length === 0) {
    throw new AppError(404, ERROR_CODES.META_NOT_CONFIGURED, 'Not configured');
  }
  for (const secret of secrets) {
    try {
      return parseSignedRequest(signedRequest, secret);
    } catch (err) {
      if (!(err instanceof SignedRequestError)) throw err;
    }
  }
  throw badRequest('Invalid signed_request');
}

/**
 * Connections belonging to the person in a callback. For Instagram Login Meta does not
 * document whether `user_id` is the Instagram-scoped user id (stored as the connection's
 * externalUserId) or the professional account id (stored on its SocialAccount), so both match.
 */
async function connectionsForCallback(provider, userId, extraFilter = {}) {
  const or = [{ externalUserId: userId }];
  if (provider === SOCIAL_PROVIDERS.INSTAGRAM_LOGIN) {
    const ids = await SocialAccount.find({
      platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
      externalId: userId,
    }).distinct('connection');
    if (ids.length > 0) or.push({ _id: { $in: ids } });
  }
  return SocialConnection.find({ provider, $or: or, ...extraFilter });
}

export async function handleDeauthorize(provider, signedRequest) {
  const payload = verify(provider, signedRequest);
  const connections = await connectionsForCallback(provider, String(payload.user_id), {
    status: { $ne: CONNECTION_STATUS.DISCONNECTED },
  });
  for (const connection of connections) await revokeConnectionByMeta(connection);
  logger.info({ provider, connections: connections.length }, 'Processed Meta deauthorize callback');
  return { revoked: connections.length };
}

export async function handleDataDeletion(provider, signedRequest) {
  const payload = verify(provider, signedRequest);
  const userId = String(payload.user_id);
  const connections = await connectionsForCallback(provider, userId);
  let accountsRemoved = 0;
  for (const connection of connections) {
    accountsRemoved += await deleteConnectionAndAccounts(connection, {
      actor: SYSTEM_ACTORS.META,
      reason: 'data_deletion_request',
    });
  }
  const confirmationCode = randomToken(12)
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 14)
    .toUpperCase()
    .padEnd(14, '0');
  await MetaDataDeletionRequest.create({
    confirmationCode,
    provider,
    providerUserHash: sha256(`${provider}:${userId}`),
    connectionsRemoved: connections.length,
    accountsRemoved,
  });
  logger.info(
    { provider, connections: connections.length, accountsRemoved },
    'Processed Meta data deletion request',
  );
  return {
    url: `${config.publicApiUrl}/api/v1/meta/data-deletion/${confirmationCode}`,
    confirmation_code: confirmationCode,
  };
}

export async function dataDeletionStatus(confirmationCode) {
  const request = await MetaDataDeletionRequest.findOne({ confirmationCode });
  if (!request) throw notFound('Unknown confirmation code');
  return {
    confirmationCode: request.confirmationCode,
    status: request.status,
    completedAt: request.completedAt,
    message: 'All data SocialHub held for this Meta account has been deleted.',
  };
}
