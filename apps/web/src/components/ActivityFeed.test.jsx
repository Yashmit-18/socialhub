import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityFeed } from './ActivityFeed.jsx';

// Local times, so the calendar days are the same in every time zone the tests run in.
const NOW = new Date(2026, 10, 26, 15, 0);
const at = (day, hour) => new Date(2026, 10, day, hour, 30).toISOString();
const entry = (id, createdAt) => ({
  id,
  action: 'workspace.created',
  actorName: `Person ${id}`,
  createdAt,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('ActivityFeed grouped by day', () => {
  it('puts entries under Today, Yesterday and the full date, in the order given', () => {
    render(
      <ActivityFeed
        grouped
        items={[
          entry('1', at(26, 14)),
          entry('2', at(26, 9)),
          entry('3', at(25, 18)),
          entry('4', at(20, 8)),
        ]}
      />,
    );
    const days = screen.getAllByRole('heading', { level: 2 });
    expect(days.map((h) => h.textContent)).toEqual([
      'Today',
      'Yesterday',
      expect.stringMatching(/Friday.*20.*November.*2026|Friday.*November.*20.*2026/),
    ]);
    const lists = screen.getAllByRole('list');
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(2);
    expect(within(lists[1]).getByText('Person 3')).toBeInTheDocument();
    expect(within(lists[2]).getByText('Person 4')).toBeInTheDocument();
  });

  it('joins entries of a later page to a day already shown', () => {
    render(
      <ActivityFeed
        grouped
        items={[entry('1', at(24, 16)), entry('2', at(24, 10)), entry('3', at(24, 7))]}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows the clock time and keeps the full date in the title', () => {
    render(<ActivityFeed grouped items={[entry('1', at(26, 14))]} />);
    const time = screen.getByText((_, node) => node?.tagName === 'TIME');
    expect(time.textContent).toMatch(/2:30|14:30/);
    expect(time).toHaveAttribute('title', expect.stringMatching(/2026/));
  });

  it('keeps the relative time in the ungrouped list', () => {
    render(<ActivityFeed items={[entry('1', at(26, 14))]} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('30 minutes ago')).toBeInTheDocument();
  });
});
