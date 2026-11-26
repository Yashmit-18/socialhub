import { useId } from 'react';
import { cn } from '../../lib/utils.js';

/*
 * Small drawings for empty and not-found states. One frame (160 x 96), strokes and flat fills
 * only, colours from classes so they follow the theme, and no text, numbers or names (so they
 * never need a "Sample" label). `tone` picks the accent: a key of SOFT_TONES (unknown keys use
 * brand). Pass the component to EmptyState: `<EmptyState art={PostsArt} … />`.
 */

const CARD = 'fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-white/15';
const LINE = 'stroke-slate-200 dark:stroke-white/10';
const DOT = 'fill-slate-100 stroke-slate-300 dark:fill-white/5 dark:stroke-white/15';
const PERSON = 'stroke-slate-300 dark:stroke-white/15';

const ACCENTS = {
  brand: {
    soft: 'fill-brand-100 dark:fill-brand-500/20',
    line: 'stroke-brand-400 dark:stroke-brand-300/70',
    solid: 'fill-brand-500',
  },
  violet: {
    soft: 'fill-violet-100 dark:fill-violet-500/20',
    line: 'stroke-violet-400 dark:stroke-violet-300/70',
    solid: 'fill-violet-500',
  },
  fuchsia: {
    soft: 'fill-fuchsia-100 dark:fill-fuchsia-500/20',
    line: 'stroke-fuchsia-400 dark:stroke-fuchsia-300/70',
    solid: 'fill-fuchsia-500',
  },
  pink: {
    soft: 'fill-pink-100 dark:fill-pink-500/20',
    line: 'stroke-pink-400 dark:stroke-pink-300/70',
    solid: 'fill-pink-500',
  },
  blue: {
    soft: 'fill-blue-100 dark:fill-blue-500/20',
    line: 'stroke-blue-400 dark:stroke-blue-300/70',
    solid: 'fill-blue-500',
  },
  sky: {
    soft: 'fill-sky-100 dark:fill-sky-500/20',
    line: 'stroke-sky-400 dark:stroke-sky-300/70',
    solid: 'fill-sky-500',
  },
  teal: {
    soft: 'fill-teal-100 dark:fill-teal-500/20',
    line: 'stroke-teal-500 dark:stroke-teal-300/70',
    solid: 'fill-teal-500',
  },
  amber: {
    soft: 'fill-amber-100 dark:fill-amber-500/20',
    line: 'stroke-amber-400 dark:stroke-amber-300/70',
    solid: 'fill-amber-500',
  },
  neutral: {
    soft: 'fill-slate-100 dark:fill-white/[0.06]',
    line: 'stroke-slate-400 dark:stroke-slate-500',
    solid: 'fill-slate-400 dark:fill-slate-500',
  },
};

const accent = (tone) => ACCENTS[tone] ?? ACCENTS.brand;

function Frame({ className, children }) {
  return (
    <svg
      viewBox="0 0 160 96"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('h-24 w-40', className)}
    >
      {children}
    </svg>
  );
}

/** A post card with a paper plane leaving it. Posts, scheduled posts. */
export function PostsArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="18" y="24" width="84" height="58" rx="10" className={CARD} strokeWidth="1.5" />
      <circle cx="34" cy="40" r="6" className={cn(a.soft, a.line)} strokeWidth="1.5" />
      <path d="M46 37h30M46 44h18" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <rect x="28" y="54" width="64" height="18" rx="5" className={a.soft} />
      <path
        d="M104 42c11-4 18-11 23-21"
        className={a.line}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 5"
      />
      <path
        d="M146 8l-22 7 9 5 3 10z"
        className={cn(a.soft, a.line)}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M133 20l13-12" className={a.line} strokeWidth="1.5" strokeLinecap="round" />
    </Frame>
  );
}

/** A list of three items, the first one ticked. Tasks, checklists. */
export function TasksArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="30" y="12" width="100" height="72" rx="10" className={CARD} strokeWidth="1.5" />
      <circle cx="46" cy="30" r="6" className={cn(a.soft, a.line)} strokeWidth="1.5" />
      <path d="M58 30h34" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="114" cy="30" r="6" className={a.solid} />
      <path
        d="M111.2 30l2 2 3.6-4"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="48" r="6" className={DOT} strokeWidth="1.5" />
      <path d="M58 48h26" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="114" cy="48" r="5.25" className={LINE} strokeWidth="1.5" />
      <circle cx="46" cy="66" r="6" className={DOT} strokeWidth="1.5" />
      <path d="M58 66h30" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="114" cy="66" r="5.25" className={LINE} strokeWidth="1.5" />
    </Frame>
  );
}

/** One post fanning out to three places. Shares, destinations. */
export function SharesArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="14" y="26" width="54" height="44" rx="8" className={CARD} strokeWidth="1.5" />
      <path d="M24 38h34M24 46h22" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <rect x="24" y="54" width="34" height="8" rx="3" className={a.soft} />
      <path
        d="M68 48h14M82 48c6 0 6-26 14-26M82 48h14M82 48c6 0 6 26 14 26"
        className={a.line}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 4"
      />
      {[12, 38, 64].map((y) => (
        <g key={y}>
          <rect x="96" y={y} width="50" height="20" rx="10" className={CARD} strokeWidth="1.5" />
          <circle cx="107" cy={y + 10} r="4" className={cn(a.soft, a.line)} strokeWidth="1.5" />
          <path d={`M116 ${y + 10}h20`} className={LINE} strokeWidth="3.5" strokeLinecap="round" />
        </g>
      ))}
    </Frame>
  );
}

/** Three people in a frame, with a plus. Groups, a team to invite. */
export function GroupsArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="34" y="16" width="92" height="64" rx="12" className={CARD} strokeWidth="1.5" />
      <circle cx="56" cy="44" r="6" className={DOT} strokeWidth="1.5" />
      <path d="M45 66c0-6 4-10 11-10" className={PERSON} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="104" cy="44" r="6" className={DOT} strokeWidth="1.5" />
      <path d="M115 66c0-6-4-10-11-10" className={PERSON} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="80" cy="40" r="8" className={cn(a.soft, a.line)} strokeWidth="1.5" />
      <path
        d="M64 66c0-9 7-14 16-14s16 5 16 14"
        className={a.line}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="126" cy="16" r="9" className={a.solid} />
      <path d="M126 12v8M122 16h8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </Frame>
  );
}

/** Two people side by side. Users, members, nobody matching a search of people. */
export function PeopleArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="22" y="20" width="56" height="60" rx="10" className={CARD} strokeWidth="1.5" />
      <circle cx="50" cy="42" r="9" className={cn(a.soft, a.line)} strokeWidth="1.5" />
      <path
        d="M36 70c0-8 6-13 14-13s14 5 14 13"
        className={a.line}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="84" y="28" width="54" height="52" rx="10" className={CARD} strokeWidth="1.5" />
      <circle cx="111" cy="47" r="8" className={DOT} strokeWidth="1.5" />
      <path
        d="M98 72c0-7 6-12 13-12s13 5 13 12"
        className={PERSON}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M92 16h20" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M92 8h32" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
    </Frame>
  );
}

/** A phone with the outline of a post. Previews. */
export function PreviewArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="52" y="4" width="56" height="88" rx="10" className={CARD} strokeWidth="1.5" />
      <circle cx="65" cy="19" r="5" className={cn(a.soft, a.line)} strokeWidth="1.5" />
      <path d="M76 17h20M76 23h12" className={LINE} strokeWidth="3" strokeLinecap="round" />
      <rect x="60" y="32" width="40" height="30" rx="4" className={a.soft} />
      <path d="M60 71h40M60 79h26" className={LINE} strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

/** A ghost of a feed: three quiet rows, the newest in colour. Activity, audit logs. */
export function FeedArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="20.5" y="6.5" width="119" height="83" rx="11.5" className={CARD} strokeWidth="1.5" />
      {[24, 48, 72].map((y, i) => (
        <g key={y}>
          <circle
            cx="40"
            cy={y}
            r="7"
            className={i === 0 ? cn(a.soft, a.line) : DOT}
            strokeWidth="1.5"
          />
          <path
            d={`M54 ${y - 3}h${i === 1 ? 52 : 68}`}
            className={LINE}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path d={`M54 ${y + 5}h30`} className={LINE} strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
    </Frame>
  );
}

/** A chart card whose line has not been drawn yet. Insights, metrics. */
export function InsightsArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="16" y="10" width="128" height="76" rx="10" className={CARD} strokeWidth="1.5" />
      <path d="M30 24h34" className={LINE} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M30 72h100" className={LINE} strokeWidth="1.5" strokeLinecap="round" />
      {[
        [38, 12],
        [56, 20],
        [74, 16],
        [92, 26],
        [110, 22],
      ].map(([x, h]) => (
        <rect key={x} x={x - 4} y={70 - h} width="8" height={h} rx="2.5" className={a.soft} />
      ))}
      <path
        d="M34 54c12-4 18 4 30-6s18-8 26-2 16-2 24-10"
        className={a.line}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray="3 5"
      />
      <circle
        cx="114"
        cy="36"
        r="4"
        className={cn('fill-white dark:fill-slate-900', a.line)}
        strokeWidth="1.75"
      />
    </Frame>
  );
}

/** Three ranked rows, the first one highlighted. Top posts, rankings. */
export function RankingArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="22" y="8" width="116" height="80" rx="10" className={CARD} strokeWidth="1.5" />
      {[26, 48, 70].map((y, i) => (
        <g key={y}>
          <circle cx="40" cy={y} r="6" className={i === 0 ? a.solid : DOT} strokeWidth="1.5" />
          <rect
            x="52"
            y={y - 8}
            width="16"
            height="16"
            rx="4"
            className={i === 0 ? a.soft : 'fill-slate-100 dark:fill-white/[0.06]'}
          />
          <path
            d={`M76 ${y - 2}h${[44, 34, 26][i]}`}
            className={LINE}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path d={`M76 ${y + 5}h18`} className={LINE} strokeWidth="2.5" strokeLinecap="round" />
        </g>
      ))}
    </Frame>
  );
}

/** A hub joined to two accounts, one still to connect. Social accounts, logins. */
export function ConnectArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <path
        d="M62 48H40M98 48h22"
        className={a.line}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 4"
      />
      <rect x="12" y="30" width="36" height="36" rx="10" className={CARD} strokeWidth="1.5" />
      <circle cx="30" cy="44" r="5" className={cn(a.soft, a.line)} strokeWidth="1.5" />
      <path d="M22 56h16" className={LINE} strokeWidth="3" strokeLinecap="round" />
      <rect
        x="62"
        y="26"
        width="36"
        height="44"
        rx="12"
        className={cn(a.soft, a.line)}
        strokeWidth="1.5"
      />
      <circle cx="80" cy="48" r="7" className={a.solid} />
      <rect
        x="112"
        y="30"
        width="36"
        height="36"
        rx="10"
        className="fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-white/20"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <path d="M130 42v12M124 48h12" className={a.line} strokeWidth="1.75" strokeLinecap="round" />
    </Frame>
  );
}

/** A magnifier over an empty list. Searches and filters that match nothing. */
export function SearchArt({ tone, className }) {
  const a = accent(tone);
  return (
    <Frame className={className}>
      <rect x="24" y="14" width="88" height="68" rx="10" className={CARD} strokeWidth="1.5" />
      <path
        d="M38 32h44M38 46h30M38 60h38"
        className={LINE}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="108" cy="54" r="17" className={cn(a.soft, a.line)} strokeWidth="2" />
      <path d="M120.5 66.5l13 13" className={a.line} strokeWidth="4" strokeLinecap="round" />
      <path d="M101 54h14" className={a.line} strokeWidth="2" strokeLinecap="round" />
    </Frame>
  );
}

/** The three nodes of the logo with one link broken. Page or workspace not found. */
export function BrokenLinkArt({ className }) {
  const id = `sh-art-${useId().replace(/:/g, '')}`;
  const gradient = `url(#${id})`;
  return (
    <Frame className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#a855f7" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <path d="M62 43l36-16" stroke={gradient} strokeWidth="5" strokeLinecap="round" />
      <path d="M62 54l13 6" stroke={gradient} strokeWidth="5" strokeLinecap="round" />
      <path
        d="M86 65l13 6"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="1 9"
        className="stroke-slate-300 dark:stroke-white/25"
      />
      <circle cx="50" cy="48" r="14" fill={gradient} />
      <circle cx="108" cy="22" r="10" fill={gradient} opacity="0.85" />
      <circle
        cx="112"
        cy="76"
        r="10"
        strokeWidth="3"
        strokeDasharray="4 5"
        className="fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-white/25"
      />
    </Frame>
  );
}
