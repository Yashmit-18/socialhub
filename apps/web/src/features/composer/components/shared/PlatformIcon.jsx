import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { FacebookIcon, InstagramIcon } from '../../../../components/ui/Brand.jsx';
import { cn } from '../../../../lib/utils.js';

const SIZES = {
  '2xs': 'h-3.5 w-3.5 rounded-[4px] [&_svg]:h-2 [&_svg]:w-2',
  xs: 'h-4 w-4 rounded [&_svg]:h-2.5 [&_svg]:w-2.5',
  sm: 'h-5 w-5 rounded-md [&_svg]:h-3 [&_svg]:w-3',
  md: 'h-8 w-8 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-10 w-10 rounded-xl [&_svg]:h-5 [&_svg]:w-5',
};

/** Brand-coloured square mark for a destination platform (decorative). */
export function PlatformIcon({ platform, size = 'sm', className }) {
  const isFacebook = platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-white',
        isFacebook
          ? 'bg-[#1877F2]'
          : 'bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400',
        SIZES[size],
        className,
      )}
    >
      {isFacebook ? <FacebookIcon /> : <InstagramIcon />}
    </span>
  );
}

const HAS_HEIGHT = /(?:^|\s)h-/;

/**
 * Monochrome inline glyph (inherits text colour) for tabs, filters and labels; 16px unless
 * `className` sets a height (e.g. "h-3.5 w-3.5").
 *
 * The Brand.jsx icons always carry `h-5 w-5`, which outranks smaller size utilities in
 * Tailwind's generated CSS, so the size lives on a wrapper and the SVG fills it.
 */
export function PlatformGlyph({ platform, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full',
        !HAS_HEIGHT.test(className ?? '') && 'h-4 w-4',
        className,
      )}
    >
      {platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE ? <FacebookIcon /> : <InstagramIcon />}
    </span>
  );
}
