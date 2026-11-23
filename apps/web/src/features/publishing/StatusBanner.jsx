import { AlertTriangle, FlaskConical, Info, PowerOff } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const TONES = {
  info: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100',
  neutral:
    'border-slate-200 bg-slate-50 text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-100',
};

const ICONS = { simulated: FlaskConical, disabled: PowerOff, info: Info };

/** One notice above the job list. Warnings are announced to screen readers. */
export function Notice({ tone = 'info', icon, title, text, className }) {
  const Icon = icon ?? (tone === 'warning' ? AlertTriangle : Info);
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm',
        TONES[tone] ?? TONES.info,
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 break-words">
        <span className="font-semibold">{title}</span>
        {text && <> {text}</>}
      </p>
    </div>
  );
}

/** Notices derived from `GET /publishing/status` (see `statusNotices`). */
export function StatusBanner({ notices, className }) {
  if (!notices || notices.length === 0) return null;
  return (
    <div className={cn('space-y-3', className)}>
      {notices.map((notice) => (
        <Notice
          key={notice.key}
          tone={notice.tone}
          icon={ICONS[notice.key]}
          title={notice.title}
          text={notice.text}
        />
      ))}
    </div>
  );
}
