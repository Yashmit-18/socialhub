import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  FeedPhone,
  GroupShareBoard,
  HeroPostPair,
  HeroSocial,
  PostChipRow,
  SyncHistory,
} from './LandingSocial.jsx';
import { ComposerDemo } from './LandingVisuals.jsx';
import { FEED_POSTS, GROUP_TASKS, HERO_POSTS, POST_CHIPS } from './landingSamples.js';
import { usePauseOffscreen } from './useMotion.js';

// jsdom has no IntersectionObserver, so every piece renders its finished content at once.
describe('landing social illustrations', () => {
  it('render hidden from assistive technology, each with its sample label', () => {
    const { container } = render(
      <>
        <HeroSocial />
        <HeroPostPair />
        <PostChipRow />
        <SyncHistory />
        <GroupShareBoard />
        <FeedPhone />
      </>,
    );
    for (const root of container.children) {
      expect(root).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getAllByText('Sample post')).toHaveLength(2);
    expect(screen.getAllByText('Sample posts')).toHaveLength(2);
    expect(screen.getByText('Sample data for illustration')).toBeInTheDocument();
    expect(screen.getByText('Sync history')).toBeInTheDocument();
    expect(screen.getByText('Meta temporarily unavailable')).toBeInTheDocument();
  });

  it('never shows Instagram as published or scheduled', () => {
    for (const { kind, status } of [...HERO_POSTS, ...POST_CHIPS]) {
      if (kind === 'instagram') expect(['Preview', 'Draft']).toContain(status[1]);
    }
    expect(FEED_POSTS.every((post) => !post.status)).toBe(true);

    render(<HeroPostPair />);
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('shows group sharing as manual tasks that people mark as shared', () => {
    render(<GroupShareBoard />);
    expect(
      screen.getByText('One task per group. Each is posted by hand on Facebook.'),
    ).toBeInTheDocument();
    for (const { by } of GROUP_TASKS.filter((task) => task.by)) {
      expect(screen.getByText(`Shared by ${by.name}`)).toBeInTheDocument();
    }
    // One group is still waiting for someone to post it.
    expect(GROUP_TASKS.some((task) => !task.by)).toBe(true);
    expect(screen.getAllByText('Mark as shared').length).toBeGreaterThan(0);
    expect(screen.queryByText(/automatic/i)).toBeNull();
  });

  it('rests the composer demo on its published frame under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<ComposerDemo />);
    // The button and the Facebook Page preview say "Published"; Instagram stays a preview.
    expect(screen.getAllByText('Published')).toHaveLength(2);
    expect(screen.getAllByText('Not published')).toHaveLength(1);
    expect(
      screen.getByText('I understand that this publishes a real post on these accounts.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sample data for illustration')).toBeInTheDocument();
  });
});

function Sections() {
  const ref = useRef(null);
  usePauseOffscreen(ref);
  return (
    <main ref={ref}>
      <section>one</section>
      <section>two</section>
    </main>
  );
}

describe('usePauseOffscreen', () => {
  it('marks sections outside the viewport and cleans up on unmount', () => {
    let report;
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          report = callback;
        }
        observe() {}
        disconnect() {
          disconnectSpy();
        }
      },
    );
    try {
      const { container, unmount } = render(<Sections />);
      const [first, second] = container.querySelectorAll('section');
      report([
        { target: first, isIntersecting: true },
        { target: second, isIntersecting: false },
      ]);
      expect(first).not.toHaveAttribute('data-offscreen');
      expect(second).toHaveAttribute('data-offscreen');
      unmount();
      expect(disconnectSpy).toHaveBeenCalled();
      expect(second).not.toHaveAttribute('data-offscreen');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
