import { Avatar } from '../../../../components/ui/Avatar.jsx';
import { cn } from '../../../../lib/utils.js';
import { PlatformIcon } from './PlatformIcon.jsx';

const SIZES = {
  sm: { box: 'h-8 w-8', avatar: 'sm', badge: 'xs', offset: '-bottom-1 -right-1' },
  md: { box: 'h-10 w-10', avatar: 'md', badge: 'sm', offset: '-bottom-1 -right-1' },
};

/**
 * A destination's picture (or initials) with its platform mark in the corner. Decorative:
 * the account name is always rendered as text next to it.
 */
export function AccountAvatar({ account, size = 'md', showPlatform = true, className }) {
  const s = SIZES[size] ?? SIZES.md;
  return (
    <span className={cn('relative inline-flex shrink-0', s.box, className)} aria-hidden="true">
      {account.pictureUrl ? (
        <img
          src={account.pictureUrl}
          alt=""
          className={cn(s.box, 'rounded-full object-cover ring-2 ring-white dark:ring-slate-900')}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <Avatar name={account.name} seed={account.id} size={s.avatar} />
      )}
      {showPlatform && (
        <span className={cn('absolute', s.offset)}>
          <PlatformIcon
            platform={account.platform}
            size={s.badge}
            className="ring-2 ring-white dark:ring-slate-900"
          />
        </span>
      )}
    </span>
  );
}
