import { describe, expect, it } from 'vitest';
import { cn } from './utils.js';

describe('cn', () => {
  it('joins classes and skips falsy values and nested arrays', () => {
    expect(cn('a', false, null, undefined, '', ['b', ['c']])).toBe('a b c');
    expect(cn('  a   b ')).toBe('a b');
  });

  it('lets a later size replace a default size (the icon/badge bug)', () => {
    expect(cn('h-5 w-5', 'h-3.5 w-3.5 shrink-0')).toBe('h-3.5 w-3.5 shrink-0');
    expect(cn('flex h-7 w-7 rounded-full', 'h-6 w-6')).toBe('flex rounded-full h-6 w-6');
    expect(cn('h-5 w-5', 'size-3')).toBe('size-3');
    expect(cn('h-5', 'h-[18px]')).toBe('h-[18px]');
    expect(cn('min-w-0 max-w-sm', 'max-w-lg')).toBe('min-w-0 max-w-lg');
  });

  it('keeps sizes under different variants or importance apart', () => {
    expect(cn('h-4 sm:h-6', 'h-3')).toBe('sm:h-6 h-3');
    expect(cn('dark:text-white', 'text-slate-900')).toBe('dark:text-white text-slate-900');
    expect(cn('h-4!', 'h-3')).toBe('h-4! h-3');
    expect(cn('[&>svg]:h-4', '[&>svg]:h-3')).toBe('[&>svg]:h-3');
  });

  it('resolves spacing, gap and radius, including shorthands over longhands', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
    expect(cn('p-4', 'px-2')).toBe('p-4 px-2');
    expect(cn('mt-2 -mt-1')).toBe('-mt-1');
    expect(cn('gap-x-2 gap-3')).toBe('gap-3');
    expect(cn('rounded-lg', 'rounded-xl')).toBe('rounded-xl');
    expect(cn('rounded-tl-md rounded-t-lg')).toBe('rounded-t-lg');
    expect(cn('rounded-t-lg rounded-lg')).toBe('rounded-lg');
  });

  it('treats text sizes, colours and alignment as separate groups', () => {
    expect(cn('text-xs text-muted')).toBe('text-xs text-muted');
    expect(cn('text-muted', 'text-rose-600')).toBe('text-rose-600');
    expect(cn('text-sm', 'text-[11px]')).toBe('text-[11px]');
    expect(cn('text-[11px] text-[var(--lp-muted)]')).toBe('text-[11px] text-[var(--lp-muted)]');
    expect(cn('text-white/80 text-[#1877F2]')).toBe('text-[#1877F2]');
    expect(cn('text-left text-sm/6 text-center')).toBe('text-sm/6 text-center');
    expect(cn('font-medium', 'font-semibold font-sans')).toBe('font-semibold font-sans');
  });

  it('lets a conditional background or border colour override the default', () => {
    const active = true;
    expect(
      cn(
        'border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60',
        active && 'border-brand-300 bg-brand-50 dark:border-brand-400/40 dark:bg-brand-500/10',
      ),
    ).toBe('border border-brand-300 bg-brand-50 dark:border-brand-400/40 dark:bg-brand-500/10');
    // Width/side and colour are different groups; gradients are images, not colours.
    expect(cn('border-t border-slate-100', 'border-b')).toBe('border-t border-slate-100 border-b');
    expect(cn('bg-gradient-to-br from-brand-500 to-fuchsia-500 bg-white')).toBe(
      'bg-gradient-to-br from-brand-500 to-fuchsia-500 bg-white',
    );
    expect(cn('bg-gradient-to-br', 'bg-gradient-to-r')).toBe('bg-gradient-to-r');
    expect(cn('bg-linear-to-r', 'bg-gradient-to-b')).toBe('bg-gradient-to-b');
    expect(cn('ring-1 ring-slate-200', 'ring-brand-500')).toBe('ring-1 ring-brand-500');
  });

  it('knows the custom theme tokens from index.css', () => {
    expect(cn('shadow-card', 'shadow-pop')).toBe('shadow-pop');
    expect(cn('shadow-card shadow-brand-500/25')).toBe('shadow-card shadow-brand-500/25');
    expect(cn('animate-fade-in', 'animate-scale-in')).toBe('animate-scale-in');
    expect(cn('animate-bar-grow', 'animate-column-grow')).toBe('animate-column-grow');
  });

  it('passes through classes it does not know', () => {
    expect(cn('surface p-5', 'surface')).toBe('surface p-5 surface');
    expect(cn('lp-bar lp-glass', 'lp-rise')).toBe('lp-bar lp-glass lp-rise');
    expect(cn('whitespace-nowrap hidden', 'pointer-events-none')).toBe(
      'whitespace-nowrap hidden pointer-events-none',
    );
  });
});
