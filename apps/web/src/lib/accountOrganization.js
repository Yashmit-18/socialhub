import { SOCIAL_PLATFORMS } from '@socialhub/shared';

/**
 * Label colour names (shared LABEL_COLORS) mapped to complete Tailwind class strings, written
 * out in full so Tailwind generates them. `chip` styles a label chip, `dot` a colour swatch.
 */
export const LABEL_COLOR_CLASSES = {
  slate: {
    chip: 'bg-slate-100 text-slate-700 ring-slate-300/60 dark:bg-white/10 dark:text-slate-200 dark:ring-white/15',
    dot: 'bg-slate-400',
  },
  red: {
    chip: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25',
    dot: 'bg-red-500',
  },
  orange: {
    chip: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/25',
    dot: 'bg-orange-500',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
    dot: 'bg-amber-500',
  },
  green: {
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
    dot: 'bg-emerald-500',
  },
  teal: {
    chip: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/25',
    dot: 'bg-teal-500',
  },
  sky: {
    chip: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25',
    dot: 'bg-sky-500',
  },
  indigo: {
    chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/25',
    dot: 'bg-indigo-500',
  },
  violet: {
    chip: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/25',
    dot: 'bg-violet-500',
  },
  pink: {
    chip: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-500/10 dark:text-pink-300 dark:ring-pink-400/25',
    dot: 'bg-pink-500',
  },
};

export const labelColorClasses = (color) => LABEL_COLOR_CLASSES[color] ?? LABEL_COLOR_CLASSES.slate;

export const LABEL_COLOR_NAMES = {
  slate: 'Grey',
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  green: 'Green',
  teal: 'Teal',
  sky: 'Sky blue',
  indigo: 'Indigo',
  violet: 'Violet',
  pink: 'Pink',
};

/**
 * Public address of a destination on Facebook or Instagram, or null when it cannot be built
 * (an Instagram account without a username). Page ids open the Page on facebook.com.
 */
export function platformUrl(account) {
  if (!account) return null;
  if (account.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE) {
    return /^\d+$/.test(account.externalId ?? '')
      ? `https://www.facebook.com/${account.externalId}`
      : null;
  }
  if (account.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT) {
    return /^[A-Za-z0-9._]{1,30}$/.test(account.username ?? '')
      ? `https://www.instagram.com/${account.username}/`
      : null;
  }
  return null;
}

export const platformSiteName = (account) =>
  account?.platform === SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT ? 'Instagram' : 'Facebook';

/** Copies text to the clipboard; resolves to true when the browser allowed it. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Saves a downloaded blob under `fileName` through a temporary link. */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 'all' | 'some' | 'none' for each label id, from the accounts' current labels. */
export function initialLabelStates(accounts, labels) {
  const states = {};
  for (const label of labels) {
    const carrying = accounts.filter((a) => (a.labels ?? []).some((l) => l.id === label.id)).length;
    states[label.id] = carrying === 0 ? 'none' : carrying === accounts.length ? 'all' : 'some';
  }
  return states;
}

/** The add/remove lists that turn `initial` into `chosen`. */
export function labelChanges(initial, chosen) {
  const add = [];
  const remove = [];
  for (const [id, state] of Object.entries(chosen)) {
    if (state === initial[id]) continue;
    if (state === 'all') add.push(id);
    else if (state === 'none') remove.push(id);
  }
  return { add, remove };
}
