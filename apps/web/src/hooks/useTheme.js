import { useCallback, useEffect, useState } from 'react';
import { storage } from '../lib/utils.js';

const KEY = 'sh-theme';

function prefersDark() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => storage.get(KEY) ?? 'system');

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && prefersDark());
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (theme !== 'system') return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme]);

  const setTheme = useCallback((next) => {
    storage.set(KEY, next);
    setThemeState(next);
  }, []);

  const isDark = theme === 'dark' || (theme === 'system' && prefersDark());
  const toggle = useCallback(() => setTheme(isDark ? 'light' : 'dark'), [isDark, setTheme]);

  return { theme, isDark, setTheme, toggle };
}
