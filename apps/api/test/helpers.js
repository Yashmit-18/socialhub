import request from 'supertest';
import { CLIENT_HEADER, SOCIAL_PLATFORMS, SOCIAL_PROVIDERS } from '@socialhub/shared';
import { createApp } from '../src/app.js';
import { SocialAccount, SocialConnection } from '../src/models/index.js';

export const app = createApp();
export const api = () => request(app);

let counter = 0;
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}.${Date.now()}.${(counter += 1)}@example.com`;

export const DEFAULT_PASSWORD = 'Sup3rSecret!';

/** Extracts the raw refresh cookie value (`sh_rt=...`) from a response. */
export function refreshCookie(res) {
  const cookies = res.headers['set-cookie'] ?? [];
  const cookie = cookies.find((c) => c.startsWith('sh_rt='));
  return cookie ? cookie.split(';')[0] : null;
}

export async function registerUser({
  name = 'Test User',
  email = uniqueEmail(),
  password = DEFAULT_PASSWORD,
} = {}) {
  const res = await api().post('/api/v1/auth/register').send({ name, email, password });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    user: res.body.user,
    token: res.body.accessToken,
    cookie: refreshCookie(res),
    email,
    password,
  };
}

export function as(token) {
  const bind = (method) => (url) => api()[method](url).set('Authorization', `Bearer ${token}`);
  return {
    get: bind('get'),
    post: bind('post'),
    patch: bind('patch'),
    put: bind('put'),
    delete: bind('delete'),
  };
}

export function withClientHeader(req) {
  return req.set(CLIENT_HEADER, 'web');
}

export async function createWorkspace(token, body = { name: 'Acme Social' }) {
  const res = await as(token).post('/api/v1/workspaces').send(body);
  if (res.status !== 201)
    throw new Error(`create workspace failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const tokenFromInviteUrl = (url) => decodeURIComponent(url.split('/invite/')[1]);

/** Creates a user and brings them into the workspace with `role` through the real invitation flow. */
export async function addMember(workspaceId, inviterToken, role, { name = `${role} member` } = {}) {
  const member = await registerUser({ name });
  const invite = await as(inviterToken)
    .post(`/api/v1/workspaces/${workspaceId}/invitations`)
    .send({ email: member.email, role });
  if (invite.status !== 201)
    throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  const accepted = await as(member.token).post(
    `/api/v1/invitations/${encodeURIComponent(tokenFromInviteUrl(invite.body.inviteUrl))}/accept`,
  );
  if (accepted.status !== 200)
    throw new Error(`accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  return { ...member, membershipId: accepted.body.membership.id };
}

/** Owner + workspace + one member of each other role. */
export async function seedTeam() {
  const owner = await registerUser({ name: 'Olivia Owner' });
  const { workspace } = await createWorkspace(owner.token);
  const admin = await addMember(workspace.id, owner.token, 'ADMIN', { name: 'Adam Admin' });
  const editor = await addMember(workspace.id, owner.token, 'EDITOR', { name: 'Eddie Editor' });
  const viewer = await addMember(workspace.id, owner.token, 'VIEWER', { name: 'Vera Viewer' });
  const ownerMembership = (await as(owner.token).get(`/api/v1/workspaces/${workspace.id}`)).body
    .membership;
  return {
    workspace,
    owner: { ...owner, membershipId: ownerMembership.id },
    admin,
    editor,
    viewer,
  };
}

/**
 * Inserts destinations directly through the models. Phase 1 has no OAuth flow, so this is
 * the only way to exercise account scoping; it is test-only fixture data.
 */
export async function seedSocialAccounts(
  workspaceId,
  connectedBy,
  { pages = 2, instagram = 1, externalUserId = 'fb-user-1' } = {},
) {
  const connection = await SocialConnection.create({
    workspace: workspaceId,
    provider: SOCIAL_PROVIDERS.FACEBOOK_LOGIN,
    externalUserId,
    displayName: 'Fixture Identity',
    connectedBy,
  });
  const accounts = [];
  for (let i = 0; i < pages; i += 1) {
    accounts.push(
      await SocialAccount.create({
        workspace: workspaceId,
        connection: connection._id,
        platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
        externalId: `${externalUserId}-page-${i}`,
        name: `Page ${i}`,
        connectedBy,
      }),
    );
  }
  for (let i = 0; i < instagram; i += 1) {
    accounts.push(
      await SocialAccount.create({
        workspace: workspaceId,
        connection: connection._id,
        platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
        externalId: `${externalUserId}-ig-${i}`,
        name: `Instagram ${i}`,
        connectedBy,
      }),
    );
  }
  return { connection, accounts };
}
