import {
  ACTIVITY_ACTIONS,
  PUBLISH_ACTIVITY_ACTIONS,
  PUBLISH_BLOCK_REASONS,
  ROLE_LABELS,
} from '@socialhub/shared';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  KeyRound,
  Link2,
  LogOut,
  MailPlus,
  Megaphone,
  MailX,
  RefreshCw,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  StickyNote,
  Tag,
  Trash2,
  Unplug,
  UserCheck,
  UserMinus,
} from 'lucide-react';

const role = (r) => ROLE_LABELS[r] ?? r;
const provider = (p) => (p === 'INSTAGRAM_LOGIN' ? 'Instagram' : 'Facebook');

const quoted = (name) => `“${name ?? ''}”`;
const accounts = (n) => (n === 1 ? '1 account' : `${n ?? 'some'} accounts`);

const BLOCK_REASONS = {
  [PUBLISH_BLOCK_REASONS.NOT_A_MEMBER]: 'the person who scheduled it left the workspace',
  [PUBLISH_BLOCK_REASONS.NO_PUBLISH_PERMISSION]:
    'the person who scheduled it may no longer publish',
  [PUBLISH_BLOCK_REASONS.NO_ACCOUNT_ACCESS]:
    'the person who scheduled it may no longer use this account',
};

/** Publishing entries. Simulated jobs always say so: nothing was posted for them. */
function describePublishing(entry, actor, m) {
  const simulated = m.simulated ? ' (simulation, nothing was posted)' : '';
  const account = entry.target?.label ?? 'an account';
  switch (entry.action) {
    case PUBLISH_ACTIVITY_ACTIONS.JOB_CREATED:
      return {
        icon: Send,
        tone: 'brand',
        actor,
        text: `${m.scheduled ? 'scheduled' : 'sent'} a post to ${accounts(m.accountCount)}${simulated}`,
      };
    case PUBLISH_ACTIVITY_ACTIONS.JOB_CANCELLED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `cancelled a post for ${accounts(m.accountCount)}`,
      };
    case PUBLISH_ACTIVITY_ACTIONS.JOB_RESCHEDULED:
      return {
        icon: Send,
        tone: 'neutral',
        actor,
        text: `changed the time of a scheduled post for ${accounts(m.accountCount)}${simulated}`,
      };
    case PUBLISH_ACTIVITY_ACTIONS.DESTINATION_RETRIED:
      return { icon: RefreshCw, tone: 'neutral', actor, text: `retried publishing to ${account}` };
    case PUBLISH_ACTIVITY_ACTIONS.DESTINATION_BLOCKED:
      return {
        icon: AlertTriangle,
        tone: 'danger',
        actor: 'SocialHub',
        text: `did not send a ${m.simulated ? 'simulated ' : ''}post to ${account}: ${
          BLOCK_REASONS[m.reason] ?? 'its author may no longer publish it'
        }`,
      };
    case PUBLISH_ACTIVITY_ACTIONS.DESTINATION_CANCELLED:
      return { icon: Trash2, tone: 'danger', actor, text: `cancelled publishing to ${account}` };
    case PUBLISH_ACTIVITY_ACTIONS.JOB_FINISHED: {
      const parts = [
        m.published ? `${m.published} ${m.simulated ? 'simulated' : 'published'}` : null,
        m.failed ? `${m.failed} failed` : null,
        m.cancelled ? `${m.cancelled} cancelled` : null,
      ].filter(Boolean);
      return {
        icon: m.failed ? AlertTriangle : Send,
        tone: m.failed ? 'danger' : 'success',
        actor: 'SocialHub',
        text: `finished ${m.simulated ? 'a simulated post' : 'a post'}: ${parts.join(', ') || 'nothing sent'}`,
      };
    }
    default:
      return null;
  }
}

const FIELD_LABELS = { name: 'name', slug: 'URL', timezone: 'time zone' };

/** Human-readable rendering of an activity entry: `{ icon, tone, text }` where text is [actor, rest]. */
export function describeActivity(entry) {
  const actor = entry.actorName ?? 'Someone';
  const target = entry.target?.label ?? 'a member';
  const m = entry.metadata ?? {};

  const publishing = describePublishing(entry, actor, m);
  if (publishing) return publishing;

  switch (entry.action) {
    case ACTIVITY_ACTIONS.WORKSPACE_CREATED:
      return { icon: Building2, tone: 'brand', actor, text: 'created the workspace' };
    case ACTIVITY_ACTIONS.WORKSPACE_UPDATED: {
      const fields = Object.keys(m.after ?? {}).map((k) => FIELD_LABELS[k] ?? k);
      return {
        icon: Settings,
        tone: 'neutral',
        actor,
        text: `updated the workspace ${fields.join(', ') || 'settings'}`,
      };
    }
    case ACTIVITY_ACTIONS.WORKSPACE_OWNERSHIP_TRANSFERRED:
      return {
        icon: ArrowRightLeft,
        tone: 'violet',
        actor,
        text: `transferred ownership to ${target}`,
      };
    case ACTIVITY_ACTIONS.INVITATION_CREATED:
      return { icon: MailPlus, tone: 'sky', actor, text: `invited ${target} as ${role(m.role)}` };
    case ACTIVITY_ACTIONS.INVITATION_RESENT:
      return { icon: RefreshCw, tone: 'sky', actor, text: `resent the invitation to ${target}` };
    case ACTIVITY_ACTIONS.INVITATION_REVOKED:
      return { icon: MailX, tone: 'warning', actor, text: `revoked the invitation for ${target}` };
    case ACTIVITY_ACTIONS.INVITATION_ACCEPTED:
      return {
        icon: UserCheck,
        tone: 'success',
        actor,
        text: `joined the workspace as ${role(m.role)}`,
      };
    case ACTIVITY_ACTIONS.MEMBER_ROLE_CHANGED:
      return {
        icon: ShieldCheck,
        tone: 'brand',
        actor,
        text: `changed ${target}'s role from ${role(m.from)} to ${role(m.to)}`,
      };
    case ACTIVITY_ACTIONS.MEMBER_ACCOUNT_ACCESS_UPDATED:
      return {
        icon: KeyRound,
        tone: 'neutral',
        actor,
        text: `set ${target}'s account access to ${m.mode === 'ALL' ? 'all accounts' : `${m.accountCount} selected account${m.accountCount === 1 ? '' : 's'}`}`,
      };
    case ACTIVITY_ACTIONS.MEMBER_REMOVED:
      return {
        icon: UserMinus,
        tone: 'danger',
        actor,
        text: `removed ${target} from the workspace`,
      };
    case ACTIVITY_ACTIONS.MEMBER_LEFT:
      return { icon: LogOut, tone: 'warning', actor, text: 'left the workspace' };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_CONNECTED:
      return {
        icon: Link2,
        tone: 'success',
        actor,
        text: `connected the ${provider(m.provider)} login ${target}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_RECONNECTED:
      return {
        icon: RefreshCw,
        tone: 'success',
        actor,
        text: `reconnected the ${provider(m.provider)} login ${target}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_SYNCED:
      return { icon: RefreshCw, tone: 'neutral', actor, text: `synced ${target} with Meta` };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_STATUS_CHANGED:
      return {
        icon: AlertTriangle,
        tone: m.to === 'ACTIVE' ? 'success' : 'warning',
        actor,
        text: `marked ${target} as ${String(m.to ?? '').toLowerCase()}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_DISCONNECTED:
      return { icon: Unplug, tone: 'warning', actor, text: `disconnected ${target}` };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_REMOVED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `removed ${target}${m.accountsRemoved ? ` and ${m.accountsRemoved} account${m.accountsRemoved === 1 ? '' : 's'}` : ''}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_CONNECTION_REVOKED:
      return {
        icon: Unplug,
        tone: 'danger',
        actor,
        text: `reported that ${target} removed SocialHub's access`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_ADDED:
      return {
        icon: Share2,
        tone: 'success',
        actor,
        text: `added ${target}${m.via ? ` via ${m.via}` : ''}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_RELINKED:
      return {
        icon: Link2,
        tone: 'brand',
        actor,
        text: `moved ${target} to the login ${m.via ?? ''}`.trim(),
      };
    case ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_REMOVED:
      return { icon: Trash2, tone: 'danger', actor, text: `removed ${target} from the workspace` };
    case ACTIVITY_ACTIONS.CONTENT_PACKAGE_CREATED:
      return { icon: Share2, tone: 'brand', actor, text: 'saved a new draft' };
    case ACTIVITY_ACTIONS.CONTENT_PACKAGE_UPDATED:
      return { icon: Settings, tone: 'neutral', actor, text: 'edited a draft' };
    case ACTIVITY_ACTIONS.CONTENT_PACKAGE_DELETED:
      return { icon: Trash2, tone: 'danger', actor, text: 'deleted a draft' };
    case ACTIVITY_ACTIONS.MEDIA_UPLOADED:
      return {
        icon: Share2,
        tone: 'success',
        actor,
        text: `uploaded ${entry.target?.label ?? 'a file'}`,
      };
    case ACTIVITY_ACTIONS.MEDIA_DELETED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `deleted the file ${entry.target?.label ?? ''}`.trim(),
      };
    case ACTIVITY_ACTIONS.ACCOUNT_PRESET_CREATED:
      return {
        icon: KeyRound,
        tone: 'brand',
        actor,
        text: `created the account preset ${entry.target?.label ?? ''}`.trim(),
      };
    case ACTIVITY_ACTIONS.ACCOUNT_PRESET_DELETED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `deleted the account preset ${entry.target?.label ?? ''}`.trim(),
      };
    case ACTIVITY_ACTIONS.ACCOUNT_LABEL_CREATED:
      return { icon: Tag, tone: 'brand', actor, text: `created the label ${quoted(target)}` };
    case ACTIVITY_ACTIONS.ACCOUNT_LABEL_UPDATED:
      return {
        icon: Tag,
        tone: 'neutral',
        actor,
        text: m.name
          ? `renamed the label ${quoted(m.name.from)} to ${quoted(m.name.to)}`
          : `changed the colour of the label ${quoted(target)}`,
      };
    case ACTIVITY_ACTIONS.ACCOUNT_LABEL_DELETED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `deleted the label ${quoted(target)}${m.removedFromAccounts ? ` (removed from ${accounts(m.removedFromAccounts)})` : ''}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_LABELS_UPDATED: {
      const parts = [];
      if (m.added?.length) parts.push(`added ${m.added.map(quoted).join(', ')}`);
      if (m.removed?.length) parts.push(`removed ${m.removed.map(quoted).join(', ')}`);
      return {
        icon: Tag,
        tone: 'neutral',
        actor,
        text: `${parts.join(' and ') || 'changed the labels'} on ${target}`,
      };
    }
    case ACTIVITY_ACTIONS.FACEBOOK_GROUP_ADDED:
      return {
        icon: Megaphone,
        tone: 'success',
        actor,
        text: `added the Facebook Group ${quoted(target)}`,
      };
    case ACTIVITY_ACTIONS.FACEBOOK_GROUP_UPDATED:
      return {
        icon: Megaphone,
        tone: 'neutral',
        actor,
        text: `updated the Facebook Group ${quoted(target)}`,
      };
    case ACTIVITY_ACTIONS.FACEBOOK_GROUP_REMOVED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `removed the Facebook Group ${quoted(target)}`,
      };
    case ACTIVITY_ACTIONS.GROUP_SHARE_CREATED:
      return {
        icon: Megaphone,
        tone: 'brand',
        actor,
        text: `created the group share ${quoted(target)} for ${m.groups === 1 ? '1 group' : `${m.groups ?? 'some'} groups`}`,
      };
    case ACTIVITY_ACTIONS.GROUP_SHARE_DELETED:
      return {
        icon: Trash2,
        tone: 'danger',
        actor,
        text: `deleted the group share ${quoted(target)}`,
      };
    case ACTIVITY_ACTIONS.SHARING_TASK_COMPLETED:
      return {
        icon: Megaphone,
        tone: 'success',
        actor,
        text: `shared ${m.share ? quoted(m.share) : 'a post'} in ${quoted(m.group ?? target)}`,
      };
    case ACTIVITY_ACTIONS.SHARING_TASK_SKIPPED:
      return {
        icon: Megaphone,
        tone: 'neutral',
        actor,
        text: `skipped ${quoted(m.group ?? target)} for ${m.share ? quoted(m.share) : 'a share'}`,
      };
    case ACTIVITY_ACTIONS.SHARING_TASK_REOPENED:
      return {
        icon: RefreshCw,
        tone: 'neutral',
        actor,
        text: `reopened the sharing task for ${quoted(m.group ?? target)}`,
      };
    case ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_NOTES_UPDATED:
      return {
        icon: StickyNote,
        tone: 'neutral',
        actor,
        text: m.cleared
          ? `cleared the team notes on ${target}`
          : `updated the team notes on ${target}`,
      };
    default:
      return { icon: Settings, tone: 'neutral', actor, text: entry.action };
  }
}

export const TONE_CLASSES = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
};
