import {
  ChevronDown,
  CircleCheck,
  CircleX,
  FileText,
  Info,
  ListChecks,
  TriangleAlert,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Card, CardFooter, CardHeader } from '../../../../components/ui/Card.jsx';
import { ErrorState, Skeleton } from '../../../../components/ui/Feedback.jsx';
import { cn } from '../../../../lib/utils.js';
import { platformLabel } from '../../constants/platformRules.js';
import { describeAccount } from '../../model/accounts.js';
import { SEVERITY } from '../../model/validation.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';
import { AccountAvatar } from '../shared/AccountAvatar.jsx';
import { PlatformIcon } from '../shared/PlatformIcon.jsx';

const SEVERITY_ORDER = { [SEVERITY.ERROR]: 0, [SEVERITY.WARNING]: 1, [SEVERITY.INFO]: 2 };

const SEVERITY_STYLES = {
  [SEVERITY.ERROR]: {
    icon: CircleX,
    label: 'Error',
    row: 'bg-rose-50/80 dark:bg-rose-500/[0.08]',
    hover: 'hover:bg-rose-100/70 dark:hover:bg-rose-500/[0.14]',
    tint: 'text-rose-600 dark:text-rose-400',
  },
  [SEVERITY.WARNING]: {
    icon: TriangleAlert,
    label: 'Warning',
    row: 'bg-amber-50/80 dark:bg-amber-500/[0.08]',
    hover: 'hover:bg-amber-100/70 dark:hover:bg-amber-500/[0.14]',
    tint: 'text-amber-600 dark:text-amber-400',
  },
  [SEVERITY.INFO]: {
    icon: Info,
    label: 'Suggestion',
    row: 'bg-sky-50/80 dark:bg-sky-500/[0.08]',
    hover: 'hover:bg-sky-100/70 dark:hover:bg-sky-500/[0.14]',
    tint: 'text-sky-600 dark:text-sky-400',
  },
};

/** Issues shown per group before "Show N more". */
const VISIBLE_ISSUES = 4;

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const styleOf = (severity) => SEVERITY_STYLES[severity] ?? SEVERITY_STYLES[SEVERITY.INFO];
const bySeverity = (issues) =>
  [...issues].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
const countOf = (issues, severity) => issues.filter((i) => i.severity === severity).length;

/**
 * General (post-wide) issues first, then one group per targeted platform (issues for that
 * platform not tied to one account), then one group per account with its own issues (account
 * order follows the selection). Anything else falls back to General so nothing is hidden.
 */
function buildGroups(validation, accounts) {
  const issues = validation.issues ?? [];
  const placed = new Set();
  const claim = (list) => {
    for (const issue of list) placed.add(issue);
    return list;
  };

  const platformGroups = (validation.platforms ?? []).map((platform) => ({
    key: `platform:${platform}`,
    kind: 'platform',
    platform,
    title: platformLabel(platform),
    issues: claim(issues.filter((i) => i.platform === platform && !i.accountId)),
  }));

  const known = new Map(
    [...(accounts ?? []), ...(validation.selected ?? [])].map((account) => [account.id, account]),
  );
  const selectionOrder = (validation.selected ?? []).map((account) => account.id);
  const rank = (id) => {
    const index = selectionOrder.indexOf(id);
    return index === -1 ? selectionOrder.length : index;
  };
  const accountIds = [...new Set(issues.filter((i) => i.accountId).map((i) => i.accountId))];
  const accountGroups = accountIds
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => {
      const account = known.get(id) ?? null;
      return {
        key: `account:${id}`,
        kind: 'account',
        account,
        title: account?.name ?? 'Unavailable account',
        issues: claim(issues.filter((i) => i.accountId === id)),
      };
    });

  const general = issues.filter((issue) => !placed.has(issue));
  return [
    ...(general.length > 0
      ? [{ key: 'general', kind: 'general', title: 'General', issues: general }]
      : []),
    ...platformGroups,
    ...accountGroups,
  ].map((group) => ({ ...group, issues: bySeverity(group.issues) }));
}

function GroupIcon({ group }) {
  if (group.kind === 'platform') return <PlatformIcon platform={group.platform} size="md" />;
  if (group.kind === 'account' && group.account) {
    return <AccountAvatar account={group.account} size="sm" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400"
    >
      <FileText className="h-4 w-4" />
    </span>
  );
}

function GroupCounts({ issues }) {
  const counts = [SEVERITY.ERROR, SEVERITY.WARNING, SEVERITY.INFO]
    .map((severity) => ({ severity, n: countOf(issues, severity) }))
    .filter(({ n }) => n > 0);
  if (counts.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      {counts.map(({ severity, n }) => {
        const style = styleOf(severity);
        const Icon = style.icon;
        const noun = style.label.toLowerCase();
        return (
          <span
            key={severity}
            className={cn('inline-flex items-center gap-1 text-xs font-semibold', style.tint)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {n}
            <span className="sr-only">{` ${n === 1 ? noun : `${noun}s`}`}</span>
          </span>
        );
      })}
    </span>
  );
}

function IssueRow({ issue, prefix, onSelect }) {
  const style = styleOf(issue.severity);
  const Icon = style.icon;
  const message =
    prefix && issue.message.startsWith(prefix) ? issue.message.slice(prefix.length) : issue.message;
  const rowClass = cn(
    'flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200',
    style.row,
  );
  const content = (
    <>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.tint)} aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="sr-only">{`${style.label}: `}</span>
        {message}
      </span>
    </>
  );
  return (
    <li>
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(issue)}
          className={cn(rowClass, style.hover, 'transition-colors')}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function IssueGroup({ group, onIssueSelect }) {
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, group.issues.length - VISIBLE_ISSUES);
  const visible = expanded ? group.issues : group.issues.slice(0, VISIBLE_ISSUES);
  // Account issues repeat the account name ("Acme: …"), which the group heading already shows.
  const prefix = group.kind === 'account' && group.account ? `${group.account.name}: ` : null;

  return (
    <div role="group" aria-labelledby={headingId}>
      <div className="flex items-center gap-2.5">
        <GroupIcon group={group} />
        <div className="min-w-0 flex-1">
          <h3
            id={headingId}
            className="truncate text-sm font-semibold text-slate-900 dark:text-white"
          >
            {group.title}
          </h3>
          {group.kind === 'account' && group.account && (
            <p className="truncate text-xs text-muted">{describeAccount(group.account)}</p>
          )}
        </div>
        <GroupCounts issues={group.issues} />
      </div>

      {group.issues.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/[0.08] dark:text-emerald-300">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          No problems found
        </p>
      ) : (
        <ul id={listId} className="mt-2 space-y-1.5">
          {visible.map((issue) => (
            <IssueRow key={issue.id} issue={issue} prefix={prefix} onSelect={onIssueSelect} />
          ))}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
          className="mt-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
        >
          {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}

function Summary({ errors, warnings, infos }) {
  const suggestions = infos > 0 ? ` · ${plural(infos, 'suggestion')}` : '';
  if (errors + warnings === 0) return `No problems found${suggestions}`;
  return (
    <>
      <span className={errors > 0 ? 'font-medium text-rose-600 dark:text-rose-400' : undefined}>
        {plural(errors, 'error')}
      </span>
      {' · '}
      <span className={warnings > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : undefined}>
        {plural(warnings, 'warning')}
      </span>
      {suggestions}
    </>
  );
}

/**
 * Lists what Facebook and Instagram would object to, from `validateComposer(state, accounts)`.
 * `accounts` (normalized) names account groups; it defaults to `validation.selected`.
 * `status` ('ready' | 'loading' | 'error') reflects the account list, which the checks depend
 * on: pass 'loading' while it loads so selected accounts aren't reported as missing.
 * `onIssueSelect(issue)` (optional) turns each issue into a button, e.g. to focus its field.
 */
export function ReadinessPanel({
  validation,
  accounts,
  status = 'ready',
  error,
  onRetry,
  onIssueSelect,
  className,
}) {
  const titleId = useId();
  const loading = status === 'loading' || (!validation && status !== 'error');
  const failed = status === 'error';
  const ready = !loading && !failed;

  const errors = validation?.errors?.length ?? 0;
  const warnings = validation?.warnings?.length ?? 0;
  const infos = validation?.infos?.length ?? 0;
  const groups = ready ? buildGroups(validation, accounts) : [];
  const checked = (validation?.platforms ?? []).map(platformLabel);
  const selectedCount = validation?.selected?.length ?? 0;

  let body;
  if (loading) {
    body = (
      <div className="space-y-2.5" aria-hidden="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-11/12" />
        <Skeleton className="h-9 w-4/5" />
      </div>
    );
  } else if (failed) {
    body = (
      <ErrorState
        title="Couldn't run the readiness check"
        error={error ?? { message: "Your social accounts couldn't be loaded." }}
        onRetry={onRetry}
      />
    );
  } else if (validation.issues.length === 0) {
    body = (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50/80 px-4 py-3 dark:bg-emerald-500/[0.08]">
        <CircleCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Nothing to fix
          </p>
          <p className="mt-0.5 text-sm text-emerald-800/80 dark:text-emerald-300/80">
            {checked.length > 0
              ? `Checked against ${checked.join(' and ')} requirements for the selected ${
                  selectedCount === 1 ? 'account' : 'accounts'
                }.`
              : 'Checked against Facebook and Instagram requirements.'}
          </p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        {groups.map((group) => (
          <IssueGroup key={group.key} group={group} onIssueSelect={onIssueSelect} />
        ))}
      </div>
    );
  }

  return (
    <Card aria-labelledby={titleId} className={cn('min-w-0', className)}>
      <CardHeader
        icon={ListChecks}
        title={<span id={titleId}>Readiness check</span>}
        description={
          <span role="status" aria-live="polite" aria-atomic="true">
            {loading ? (
              'Checking…'
            ) : failed ? (
              'Not checked'
            ) : (
              <Summary errors={errors} warnings={warnings} infos={infos} />
            )}
          </span>
        }
      />
      <div className="px-5 pb-5 pt-4 sm:px-6">{body}</div>
      <CardFooter>
        <p className="flex w-full items-start gap-2 text-xs text-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {`These checks show what Facebook and Instagram require. ${CAPABILITY_MESSAGES.publishing}`}
        </p>
      </CardFooter>
    </Card>
  );
}
