import { ACTIVITY_ACTIONS, ROLE_LABELS } from '@socialhub/shared';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  KeyRound,
  Link2,
  LogOut,
  MailPlus,
  MailX,
  RefreshCw,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
  Unplug,
  UserCheck,
  UserMinus,
} from 'lucide-react';

const role = (r) => ROLE_LABELS[r] ?? r;
const provider = (p) => (p === 'INSTAGRAM_LOGIN' ? 'Instagram' : 'Facebook');

const FIELD_LABELS = { name: 'name', slug: 'URL', timezone: 'time zone' };

/** Human-readable rendering of an activity entry: `{ icon, tone, text }` where text is [actor, rest]. */
export function describeActivity(entry) {
  const actor = entry.actorName ?? 'Someone';
  const target = entry.target?.label ?? 'a member';
  const m = entry.metadata ?? {};

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
