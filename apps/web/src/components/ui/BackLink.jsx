import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils.js';

/** "Back to …" above a detail page's header. `PageHeader back={{ to, label }}` renders one. */
export function BackLink({ to, children, className }) {
  return (
    <Link
      to={to}
      className={cn(
        'group mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
        className,
      )}
    >
      <ArrowLeft
        className="h-4 w-4 transition-transform duration-200 ease-out-expo group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
      {children}
    </Link>
  );
}
