import { cn } from '../../lib/utils.js';

export function LogoMark({ className }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8', className)} aria-hidden="true">
      <defs>
        <linearGradient id="sh-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#sh-logo)" />
      <circle cx="11" cy="16" r="3.2" fill="#fff" />
      <circle cx="21.5" cy="10" r="2.6" fill="#fff" opacity=".85" />
      <circle cx="21.5" cy="22" r="2.6" fill="#fff" opacity=".85" />
      <path
        d="M13.6 14.6l5.6-3.2M13.6 17.4l5.6 3.2"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className, light = false }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span
        className={cn(
          'text-[17px] font-semibold tracking-tight',
          light ? 'text-white' : 'text-slate-900 dark:text-white',
        )}
      >
        Social
        <span className={light ? 'text-white/80' : 'text-brand-600 dark:text-brand-400'}>Hub</span>
      </span>
    </span>
  );
}

/** Simplified platform marks (Lucide no longer ships brand icons). */
export function FacebookIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-5 w-5', className)}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.62 23.1 24 18.1 24 12.07Z" />
    </svg>
  );
}

export function InstagramIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-5 w-5', className)}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
