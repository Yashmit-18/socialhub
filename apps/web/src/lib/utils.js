import { extendTailwindMerge } from 'tailwind-merge';

/*
 * Class merging. Tailwind decides conflicts by its stylesheet order, not by class order, so
 * without merging cn('h-5 w-5', 'h-3 w-3') renders 20px (.h-5 is emitted after .h-3) and
 * cn('bg-white', active && 'bg-brand-50') never shows the active colour. tailwind-merge keeps
 * the LAST class of each conflicting group (per variant, e.g. `dark:` or `hover:`), so a
 * caller's className or a conditional class always overrides the default before it.
 *
 * Registered so they merge in the right group:
 * - `bg-gradient-to-*`: Tailwind v4 still supports these v3 names (used across the app), but
 *   tailwind-merge only knows `bg-linear-to-*` and would otherwise read them as background
 *   COLOURS, dropping the gradient when a colour follows it.
 * - the custom `shadow-card` / `shadow-pop` shadows and `animate-fade-in` / `animate-scale-in`
 *   animations from index.css.
 * The `text-muted` utility is a text colour, which tailwind-merge already assumes for unknown
 * `text-*` names; `surface` and the landing page's `lp-*` classes are unknown to it and kept.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['card', 'pop'],
      animate: ['fade-in', 'scale-in'],
    },
    classGroups: {
      'bg-image': [{ bg: [{ gradient: [{ to: ['t', 'tr', 'r', 'br', 'b', 'bl', 'l', 'tl'] }] }] }],
    },
  },
});

export function cn(...parts) {
  return twMerge(parts);
}

export function initials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-violet-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-fuchsia-500 to-purple-500',
  'from-cyan-500 to-blue-500',
];

export function avatarGradient(seed = '') {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function timeAgo(value, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function timeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [
      'UTC',
      'Europe/London',
      'America/New_York',
      'Asia/Kolkata',
      'Asia/Singapore',
      'Australia/Sydney',
    ];
  }
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Client-side preview of the slug the API will generate (the API remains authoritative). */
export function slugPreview(name = '') {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode) — non-critical */
    }
  },
};

/** Only allows same-app relative paths as post-login redirects (prevents open redirects). */
export function safeRedirect(value, fallback = '/') {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return fallback;
  }
  return value;
}
