import { Circle, CircleCheck } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { checkPassword } from './passwordRules.js';

/**
 * The password rules as chips that tick while the person types. A met rule changes shape (an
 * empty ring becomes a filled tick) and says so in words for screen readers, so colour is never
 * the only cue; one polite status line reports the count when it changes. Point the field at the
 * list with `aria-describedby={id}`.
 */
export function PasswordChecklist({ id, value, className }) {
  const checks = checkPassword(value);
  const met = checks.filter((check) => check.met).length;
  return (
    <div className={className}>
      <ul id={id} aria-label="Password requirements" className="flex flex-wrap gap-1.5">
        {checks.map((check) => {
          const Icon = check.met ? CircleCheck : Circle;
          return (
            <li
              key={check.id}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border py-0.5 pr-2.5 pl-1.5 text-xs font-medium transition-colors duration-200',
                check.met
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400',
              )}
            >
              <Icon
                key={check.met ? 'met' : 'unmet'}
                className={cn('h-3.5 w-3.5 shrink-0', check.met && 'animate-pop-in')}
                aria-hidden="true"
              />
              {check.label}
              <span className="sr-only">{check.met ? ': met' : ': not met yet'}</span>
            </li>
          );
        })}
      </ul>
      <p role="status" className="sr-only">
        {`${met} of ${checks.length} password requirements met`}
      </p>
    </div>
  );
}
