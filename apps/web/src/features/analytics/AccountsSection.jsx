import { Users } from 'lucide-react';
import { AccountPicture } from '../../components/accounts/AccountBadges.jsx';
import { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { TBody, THead, Table, TableSkeleton, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { GRADIENT_TONES } from '../../components/ui/tones.js';
import { cn } from '../../lib/utils.js';
import { UNAVAILABLE, formatNumber, formatPercent, isNumber, platformLabel } from './format.js';
import { syncState } from './labels.js';
import { SectionCard } from './parts.jsx';

const METRIC_COLUMNS = [
  ['reach', 'Reach'],
  ['views', 'Views'],
  ['engagement', 'Engagement'],
  ['followers', 'Followers'],
];

const SYNC_DOT = {
  idle: 'bg-slate-300 dark:bg-slate-600',
  active: 'animate-pulse bg-brand-500',
  done: 'bg-emerald-500',
  failed: 'bg-rose-500',
};

const quiet = 'text-xs text-slate-500 dark:text-slate-400';

/**
 * One line per publishing mode. Simulated and live deliveries are never added together: a
 * simulated "published" did not reach Meta.
 */
function AccountPublishing({ modes }) {
  const shown = modes.filter((p) => p.total > 0);
  if (shown.length === 0) return <span className={quiet}>No deliveries</span>;
  return (
    <ul role="list" className="space-y-1 text-xs whitespace-nowrap">
      {shown.map((p) => (
        <li key={p.mode} className="tabular-nums">
          <span
            className={cn(
              'mr-1 font-semibold',
              p.simulated
                ? 'text-violet-700 dark:text-violet-300'
                : 'text-slate-900 dark:text-white',
            )}
          >
            {p.simulated ? 'Simulated' : 'Live'}
          </span>
          <span className="text-slate-600 dark:text-slate-300">
            {formatNumber(p.byState.PUBLISHED)} published · {formatNumber(p.byState.FAILED)} failed
            {p.successRate === null ? '' : ` · ${formatPercent(p.successRate)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SyncCell({ sync }) {
  const { text, state } = syncState(sync);
  return (
    <span
      className={cn(
        'inline-flex max-w-56 items-start gap-1.5 text-xs leading-snug',
        state === 'failed'
          ? 'text-rose-700 dark:text-rose-300'
          : 'text-slate-600 dark:text-slate-400',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', SYNC_DOT[state])}
      />
      {text}
    </span>
  );
}

const hasFigure = (item) =>
  METRIC_COLUMNS.some(([key]) => isNumber(item.insights.metrics?.[key]?.value));

/**
 * Every Page and Instagram account side by side. When no account has a single figure (insights
 * not switched on, or nothing read yet), the four metric columns say "Unavailable" once for the
 * whole block instead of in every cell.
 */
export function AccountsSection({ data, loading, fetching }) {
  const items = data?.items ?? [];
  const merged = items.length > 0 && !items.some(hasFigure);
  return (
    <SectionCard label="Accounts" fetching={fetching}>
      <CardHeader
        icon={Users}
        tone={GRADIENT_TONES.blue}
        title="Accounts"
        description="Each Facebook Page and Instagram account you can use, side by side."
      />
      {loading ? (
        <div className="mt-4 pb-1">
          <TableSkeleton rows={4} columns={6} />
        </div>
      ) : items.length === 0 ? (
        <CardBody>
          <EmptyState
            icon={Users}
            tone="blue"
            title="No accounts"
            description="No account matches these filters, or none has been shared with you."
            className="py-8"
          />
        </CardBody>
      ) : (
        <Table
          caption="Accounts"
          stickyFirst
          minWidth="min-w-[720px]"
          className="mt-4 rounded-b-xl pb-1"
        >
          <THead>
            <Th>Account</Th>
            <Th>Publishing</Th>
            {METRIC_COLUMNS.map(([key, title]) => (
              <Th key={key} align="right">
                {title}
              </Th>
            ))}
            <Th>Insights sync</Th>
          </THead>
          <TBody>
            {items.map((item, row) => {
              const metrics = item.insights.metrics;
              return (
                <Tr key={item.account.id}>
                  <Td header>
                    <span className="flex items-center gap-3">
                      <AccountPicture account={item.account} size="sm" />
                      <span className="min-w-0">
                        <span className="block max-w-48 truncate font-medium text-slate-900 dark:text-white">
                          {item.account.name}
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {platformLabel(item.account.platform)}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <AccountPublishing modes={item.publishing} />
                  </Td>
                  {merged
                    ? row === 0 && (
                        <td
                          colSpan={METRIC_COLUMNS.length}
                          rowSpan={items.length}
                          className="bg-slate-50/70 px-4 text-center align-middle text-sm text-slate-500 dark:bg-white/[0.02] dark:text-slate-400"
                        >
                          {UNAVAILABLE}
                        </td>
                      )
                    : METRIC_COLUMNS.map(([key]) => {
                        const value = metrics?.[key]?.value;
                        return (
                          <Td key={key} numeric className="text-slate-900 dark:text-white">
                            {isNumber(value) ? (
                              formatNumber(value, { short: true })
                            ) : (
                              <span className={quiet}>{UNAVAILABLE}</span>
                            )}
                          </Td>
                        );
                      })}
                  <Td>
                    <SyncCell sync={item.sync} />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </SectionCard>
  );
}
