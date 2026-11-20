import mongoose from 'mongoose';
import { hasPermission } from '@socialhub/shared';
import { forbidden, notFound } from '../lib/errors.js';
import { Membership, SocialAccount, Workspace } from '../models/index.js';
import { accessibleAccountFilter } from '../modules/socialAccounts/socialAccount.service.js';

/**
 * Resolves `:workspaceId` for the authenticated user. Non-members get 404 rather than 403
 * so workspace ids cannot be probed for existence.
 */
export async function loadWorkspace(req, _res, next) {
  const { workspaceId } = req.params;
  if (!mongoose.isValidObjectId(workspaceId)) throw notFound('Workspace not found');

  const [workspace, membership] = await Promise.all([
    Workspace.findById(workspaceId),
    Membership.findOne({ workspace: workspaceId, user: req.user._id }),
  ]);
  if (!workspace || !membership) throw notFound('Workspace not found');

  req.workspace = workspace;
  req.membership = membership;
  next();
}

/**
 * Resolves `:accountId` within the loaded workspace and enforces the member's account
 * access (role + accountAccess). Unknown, other-workspace and not-assigned accounts all get
 * the same 404, so account ids cannot be probed. Must run after loadWorkspace.
 */
export async function loadSocialAccount(req, _res, next) {
  const { accountId } = req.params;
  const missing = () => notFound('Social account not found');
  if (!mongoose.isValidObjectId(accountId)) throw missing();
  const account = await SocialAccount.findOne({
    $and: [accessibleAccountFilter(req.membership), { _id: accountId }],
  });
  if (!account) throw missing();
  req.socialAccount = account;
  next();
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.membership || !hasPermission(req.membership.role, permission)) throw forbidden();
    next();
  };
}
