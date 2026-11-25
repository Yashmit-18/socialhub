import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useTheme } from './useTheme.js';

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * The app's light/dark toggle with a circular reveal growing from the button that was pressed
 * (View Transitions API). Browsers without it, and reduced motion, switch instantly.
 */
export function useThemeTransition() {
  const { isDark, setTheme } = useTheme();

  const toggle = useCallback(
    (event) => {
      const next = isDark ? 'light' : 'dark';
      const html = document.documentElement;
      const apply = () => {
        flushSync(() => setTheme(next));
        // useTheme applies the class in an effect; set it now so the new snapshot is right.
        html.classList.toggle('dark', next === 'dark');
      };

      if (typeof document.startViewTransition !== 'function' || reducedMotion()) {
        apply();
        return;
      }

      const rect = event?.currentTarget?.getBoundingClientRect?.();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
      const y = rect ? rect.top + rect.height / 2 : 32;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      html.classList.add('vt-theme');
      const transition = document.startViewTransition(apply);
      transition.ready
        .then(() => {
          html.animate(
            {
              clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
            },
            {
              duration: 650,
              easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          );
        })
        .catch(() => {});
      transition.finished.catch(() => {}).finally(() => html.classList.remove('vt-theme'));
    },
    [isDark, setTheme],
  );

  return { isDark, toggle };
}
