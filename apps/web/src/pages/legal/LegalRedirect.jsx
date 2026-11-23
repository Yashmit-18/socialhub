import { useEffect } from 'react';
import { legalNavigation } from './legalNavigation.js';

/**
 * Short public routes (/privacy, /terms, /data-deletion) forward to the static legal pages.
 * `replace` keeps the Back button from bouncing between the alias and the page. The link
 * is a fallback if the navigation is blocked.
 */
export function LegalRedirect({ to, title }) {
  useEffect(() => {
    legalNavigation.replace(to);
  }, [to]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-muted">
      <p>
        Opening the{' '}
        <a
          href={to}
          className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
        >
          {title}
        </a>
        …
      </p>
    </div>
  );
}
