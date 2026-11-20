import { avatarGradient, cn, initials } from '../../lib/utils.js';

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

export function Avatar({ name, seed, size = 'sm', className, square = false }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-gradient-to-br font-semibold text-white shadow-sm ring-2 ring-white dark:ring-slate-900',
        square ? 'rounded-xl' : 'rounded-full',
        avatarGradient(seed ?? name),
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
