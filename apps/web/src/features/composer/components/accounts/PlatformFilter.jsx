import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { useId } from 'react';
import { cn } from '../../../../lib/utils.js';
import { PLATFORM_FILTERS } from '../../model/accounts.js';
import { PlatformGlyph } from '../shared/PlatformIcon.jsx';

const OPTIONS = [
  { value: PLATFORM_FILTERS.ALL, label: 'All', platform: null },
  {
    value: PLATFORM_FILTERS.FACEBOOK_PAGE,
    label: 'Facebook',
    platform: SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  },
  {
    value: PLATFORM_FILTERS.INSTAGRAM_ACCOUNT,
    label: 'Instagram',
    platform: SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT,
  },
];

/**
 * Segmented "All / Facebook / Instagram" filter. Built on native radio inputs, so Tab enters
 * at the checked option and the arrow keys move between options (and select them).
 * Fills the width of its container; platform names collapse to their logo when narrow.
 *
 * `counts` = model/accounts.js → countByPlatform(accounts) (optional).
 */
export function PlatformFilter({
  value = PLATFORM_FILTERS.ALL,
  onChange,
  counts,
  label = 'Filter accounts by platform',
  className,
}) {
  const name = useId();
  return (
    <div className={cn('@container w-full', className)}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex w-full gap-1 rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70 ring-inset dark:bg-white/[0.04] dark:ring-white/10"
      >
        {OPTIONS.map((option) => {
          const checked = value === option.value;
          const count = counts?.[option.value];
          const hasCount = typeof count === 'number';
          return (
            <label key={option.value} className="relative flex min-w-0 flex-1">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange?.(option.value)}
                aria-label={hasCount ? `${option.label} (${count})` : option.label}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all duration-150 select-none',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-slate-100 dark:peer-focus-visible:ring-offset-slate-900',
                  checked
                    ? cn(
                        'text-white shadow-sm',
                        option.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE
                          ? 'bg-blue-600'
                          : option.platform
                            ? 'bg-gradient-to-r from-pink-600 to-fuchsia-600'
                            : 'bg-gradient-to-r from-brand-600 to-violet-600',
                      )
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
                )}
              >
                {option.platform && (
                  <PlatformGlyph platform={option.platform} className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className={cn('truncate', option.platform && '@max-[25rem]:hidden')}>
                  {option.label}
                </span>
                {hasCount && (
                  <span
                    className={cn(
                      'min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-[18px] tabular-nums',
                      checked
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200/70 text-slate-600 dark:bg-white/10 dark:text-slate-300',
                    )}
                  >
                    {count}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
