import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useActiveIndicator } from '../../hooks/useActiveIndicator.js';
import { cn } from '../../lib/utils.js';

const STRIP =
  'overflow-x-auto overflow-y-hidden border-b border-slate-200 max-lg:no-scrollbar dark:border-white/10';

const TAB =
  'relative isolate -mb-px inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 after:absolute after:inset-x-1.5 after:top-1 after:bottom-1.5 after:-z-10 after:rounded-lg after:transition-colors';
const TAB_ACTIVE = 'text-brand-700 dark:text-white';
const TAB_IDLE =
  'text-slate-500 hover:text-slate-800 hover:after:bg-slate-900/[0.04] dark:text-slate-400 dark:hover:text-slate-100 dark:hover:after:bg-white/[0.04]';

const PILL = 'rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums';
const PILL_TONES = {
  active: 'bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-200',
  idle: 'bg-white text-slate-600 ring-1 ring-slate-200 ring-inset dark:bg-white/10 dark:text-slate-300 dark:ring-0',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
};

function CountPill({ count, active, attention }) {
  if (count === undefined || count === null) return null;
  const tone = attention && count > 0 ? attention : active ? 'active' : 'idle';
  return <span className={cn(PILL, PILL_TONES[tone])}>{count}</span>;
}

/**
 * Tabs between sub-pages (routes): `tabs` are `{ to, label, end, count, attention }`. The
 * active link gets `aria-current="page"` from NavLink and a gradient underline that slides to
 * it. `count` (when not null) is a pill inside the link, so it is part of the link's name;
 * `attention` ('danger' | 'warning') colours a count above 0. Spacing around the strip is the
 * caller's (`className="-mt-3 mb-6"` under a PageHeader).
 */
export function TabNav({ label, tabs, className }) {
  const { pathname } = useLocation();
  const listRef = useRef(null);
  const underlineRef = useRef(null);
  useActiveIndicator(listRef, underlineRef, pathname, 'x');

  return (
    <nav aria-label={label} className={cn(STRIP, className)}>
      <ul ref={listRef} className="relative flex min-w-max gap-1">
        <li
          ref={underlineRef}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-gradient-to-r from-brand-500 to-pink-500 opacity-0 data-[ready]:transition-[transform,width,opacity] data-[ready]:duration-500 data-[ready]:ease-out-expo"
        />
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => cn(TAB, isActive ? TAB_ACTIVE : TAB_IDLE)}
            >
              {({ isActive }) => (
                <>
                  {tab.label}
                  <CountPill count={tab.count} active={isActive} attention={tab.attention} />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The same tab look for a filter kept in state (no routes): `tabs` are
 * `{ key, label, count, attention }`, `value` is the active key. A group of toggle buttons
 * (`aria-pressed`) named `label`; a button with a count is named "Label (count)".
 */
export function TabButtons({ label, tabs, value, onChange, className }) {
  return (
    <div role="group" aria-label={label} className={cn(STRIP, className)}>
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.key === value;
          const counted = tab.count !== undefined && tab.count !== null;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={active}
              aria-label={counted ? `${tab.label} (${tab.count})` : undefined}
              onClick={() => onChange(tab.key)}
              className={cn(
                TAB,
                active
                  ? cn(
                      TAB_ACTIVE,
                      'before:absolute before:inset-x-2 before:bottom-0 before:h-0.5 before:rounded-full before:bg-gradient-to-r before:from-brand-500 before:to-pink-500',
                    )
                  : TAB_IDLE,
              )}
            >
              {tab.label}
              <CountPill count={tab.count} active={active} attention={tab.attention} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
