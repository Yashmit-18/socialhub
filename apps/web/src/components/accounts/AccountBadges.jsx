import { SOCIAL_PLATFORMS, SOCIAL_PROVIDERS } from '@socialhub/shared';
import { AlertTriangle, CircleCheck, CircleX, Minus } from 'lucide-react';
import { useState } from 'react';
import {
  ATTENTION_LABELS,
  CONNECTION_TONE,
  PUBLISHING_TONE,
  READINESS_HINTS,
  createContentState,
  syncResultTone,
} from '../../lib/meta.js';
import { cn, initials } from '../../lib/utils.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Badge } from '../ui/Badge.jsx';
import { FacebookIcon, InstagramIcon } from '../ui/Brand.jsx';

/** Badge from a `{ value: [tone, label] }` map. `title` becomes a native tooltip. */
export function StatusBadge({ map, value, title, className }) {
  const [tone, label] = map[value] ?? ['neutral', value ?? 'Unknown'];
  return (
    <span title={title} className={cn('inline-flex', className)}>
      <Badge tone={tone} dot>
        {label}
      </Badge>
    </span>
  );
}

/** Login (connection) status as computed by the API (`health.connectionStatus` / `connection.status`). */
export function ConnectionStatusBadge({ status, reason }) {
  return <StatusBadge map={CONNECTION_TONE} value={status} title={reason ?? undefined} />;
}

/** Publishing readiness (`health.readiness`). Describes permissions only; nothing is published. */
export function ReadinessBadge({ readiness, reasons }) {
  const title = reasons?.length ? reasons.join('\n') : READINESS_HINTS[readiness];
  return <StatusBadge map={PUBLISHING_TONE} value={readiness} title={title} />;
}

/** The CREATE_CONTENT Page-task check for one destination. */
export function CreateContentBadge({ account }) {
  const [tone, label, hint] = createContentState(account);
  return (
    <span title={hint} className="inline-flex">
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

const PAGE_ROLE_MARKS = {
  success: [CircleCheck, 'text-emerald-600 dark:text-emerald-400'],
  danger: [CircleX, 'text-rose-600 dark:text-rose-400'],
  warning: [AlertTriangle, 'text-amber-600 dark:text-amber-400'],
  neutral: [Minus, 'text-slate-400 dark:text-slate-500'],
};

/**
 * The same Page-role check as one quiet line (icon and words), for a table row where a third
 * pill would repeat what the readiness badge already says.
 */
export function PageRoleLine({ account }) {
  const [tone, label, hint] = createContentState(account);
  const [Icon, colour] = PAGE_ROLE_MARKS[tone] ?? PAGE_ROLE_MARKS.neutral;
  return (
    <p
      title={hint}
      className="flex items-start gap-1 text-[11px] leading-tight text-slate-600 dark:text-slate-300"
    >
      <Icon className={cn('mt-px h-3 w-3 shrink-0', colour)} aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}

/** Outcome of one login in a sync (`outcome`) or why it was not contacted (`skipReason`). */
export function SyncOutcomeBadge({ result }) {
  const [tone, label] = syncResultTone(result);
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

const isFacebook = (value) =>
  value === SOCIAL_PLATFORMS.FACEBOOK_PAGE || value === SOCIAL_PROVIDERS.FACEBOOK_LOGIN;

/** Facebook / Instagram brand tile, for a platform or a provider. */
export function PlatformMark({ platform, size = 'h-10 w-10', className }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl text-white',
        size,
        isFacebook(platform)
          ? 'bg-[#1877F2]'
          : 'bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400',
        className,
      )}
      aria-hidden="true"
    >
      {isFacebook(platform) ? <FacebookIcon /> : <InstagramIcon />}
    </span>
  );
}

const PICTURE_SIZES = {
  sm: {
    box: 'h-8 w-8',
    text: 'text-[11px]',
    glyph: 'h-4 w-4 [&_svg]:h-2.5 [&_svg]:w-2.5 rounded',
  },
  md: { box: 'h-10 w-10', text: 'text-xs', glyph: 'h-5 w-5 [&_svg]:h-3 [&_svg]:w-3 rounded-md' },
  lg: {
    box: 'h-14 w-14',
    text: 'text-base',
    glyph: 'h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5 rounded-md',
  },
};

/** Remote picture (Meta CDN) that falls back to `fallback` when missing or broken. */
function RemotePicture({ src, className, fallback }) {
  const [failedSrc, setFailedSrc] = useState(null);
  if (!src || failedSrc === src) return fallback;
  return (
    <img
      src={src}
      alt=""
      className={className}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

/**
 * Picture of a destination (Page or Instagram account): who it is (its picture, or its
 * initials on a neutral tile when Meta has none or the link has expired) plus a small platform
 * glyph at the corner, so the platform mark is never drawn twice and Pages stay apart.
 * Decorative: the name is always rendered next to it. `showPlatform={false}` where the list is
 * already grouped by platform.
 */
export function AccountPicture({ account, size = 'md', showPlatform = true }) {
  const s = PICTURE_SIZES[size] ?? PICTURE_SIZES.md;
  return (
    <span className="relative inline-flex shrink-0" aria-hidden="true">
      <RemotePicture
        src={account?.pictureUrl}
        className={cn(s.box, 'rounded-xl object-cover')}
        fallback={
          <span
            className={cn(
              s.box,
              s.text,
              'flex items-center justify-center rounded-xl bg-slate-100 font-semibold text-slate-600 ring-1 ring-slate-200/80 ring-inset',
              'dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10',
            )}
          >
            {initials(account?.name ?? '')}
          </span>
        }
      />
      {showPlatform && (
        <span className="absolute -right-1 -bottom-1">
          <PlatformMark
            platform={account?.platform}
            size={cn(s.glyph, 'ring-2 ring-white dark:ring-slate-900')}
          />
        </span>
      )}
    </span>
  );
}

/** Picture of a login (Facebook or Instagram identity), with its provider glyph. */
export function IdentityPicture({ connection, size = 'md' }) {
  const s = PICTURE_SIZES[size] ?? PICTURE_SIZES.md;
  const avatarSize = size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md';
  return (
    <span className="relative inline-flex shrink-0" aria-hidden="true">
      <RemotePicture
        src={connection?.pictureUrl}
        className={cn(s.box, 'rounded-full object-cover')}
        fallback={
          <Avatar
            name={connection?.displayName ?? '?'}
            seed={connection?.id}
            size={avatarSize}
            className={size === 'lg' ? 'h-14 w-14' : undefined}
          />
        }
      />
      <span className="absolute -bottom-1 -right-1">
        <PlatformMark
          platform={connection?.provider}
          size={cn(s.glyph, 'ring-2 ring-white dark:ring-slate-900')}
        />
      </span>
    </span>
  );
}

/**
 * The computed problems of a destination or login (`attention: [{ code, message }]`), most
 * important first. Renders nothing when there are none.
 */
export function AttentionList({ items, className, compact = false }) {
  if (!items?.length) return null;
  return (
    <ul className={cn('space-y-1', className)}>
      {items.map((item) => (
        <li
          key={item.code}
          className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {compact ? (
              (ATTENTION_LABELS[item.code] ?? item.code)
            ) : (
              <>
                <span className="font-medium">{ATTENTION_LABELS[item.code] ?? item.code}:</span>{' '}
                {item.message}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
