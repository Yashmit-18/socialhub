import { useCallback, useEffect, useReducer } from 'react';
import { flushSync } from 'react-dom';
import { useTheme } from '../../hooks/useTheme.js';
import { prefersReducedMotion } from './useMotion.js';

/**
 * The landing page's light/dark switch. It shares the app's preference (useTheme, stored as
 * `sh-theme`), so a visitor's choice carries over after they sign in, and vice versa.
 *
 * Switching reveals the new theme in a circle growing from the switch (View Transitions API).
 * Browsers without it get a short colour cross-fade; reduced motion switches instantly.
 */
export function useLandingTheme() {
  const { theme, setTheme } = useTheme();
  // useTheme follows the OS while the preference is "system" but does not re-render then.
  const [, refresh] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    if (theme !== 'system') return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', refresh);
    return () => media?.removeEventListener?.('change', refresh);
  }, [theme]);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));

  const switchTheme = useCallback(
    (event) => {
      const next = isDark ? 'light' : 'dark';
      const html = document.documentElement;
      const apply = () => {
        flushSync(() => setTheme(next));
        // useTheme applies the class in an effect; set it now so the new snapshot is right.
        html.classList.toggle('dark', next === 'dark');
      };

      if (prefersReducedMotion()) {
        apply();
        return;
      }

      if (typeof document.startViewTransition !== 'function') {
        const root = event?.currentTarget?.closest?.('.lp-root');
        root?.classList.add('lp-theme-fade');
        apply();
        setTimeout(() => root?.classList.remove('lp-theme-fade'), 480);
        return;
      }

      const rect = event?.currentTarget?.getBoundingClientRect?.();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
      const y = rect ? rect.top + rect.height / 2 : 32;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      html.classList.add('lp-vt');
      const transition = document.startViewTransition(apply);
      transition.ready
        .then(() => {
          html.animate(
            {
              clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
            },
            {
              duration: 720,
              easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          );
        })
        .catch(() => {});
      transition.finished.catch(() => {}).finally(() => html.classList.remove('lp-vt'));
    },
    [isDark, setTheme],
  );

  return { isDark, switchTheme };
}
