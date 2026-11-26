import { Moon, Sun } from 'lucide-react';
import { Button } from './Button.jsx';

/**
 * The light/dark switch. Controlled, so a screen keeps one theme state: pass `isDark` and
 * `onToggle` from `useThemeTransition()` (hooks/useThemeTransition.js), which also gives the
 * circular reveal from the button.
 */
export function ThemeToggle({ isDark, onToggle, className }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className={className}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        <Sun key="sun" className="h-[18px] w-[18px] animate-icon-in text-amber-300" />
      ) : (
        <Moon key="moon" className="h-[18px] w-[18px] animate-icon-in" />
      )}
    </Button>
  );
}
