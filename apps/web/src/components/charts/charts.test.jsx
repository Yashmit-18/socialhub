import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AreaChart } from './AreaChart.jsx';
import { BarChart } from './BarChart.jsx';
import { Legend } from './ChartFrame.jsx';
import { labelIndexes, niceScale } from './scale.js';

describe('niceScale', () => {
  it('finds the smallest round top in 2 to 5 steps', () => {
    expect(niceScale(5, { integer: true })).toEqual({ top: 5, ticks: [0, 1, 2, 3, 4, 5] });
    expect(niceScale(2, { integer: true })).toEqual({ top: 2, ticks: [0, 1, 2] });
    expect(niceScale(7, { integer: true }).top).toBe(8);
    expect(niceScale(12, { integer: true })).toEqual({ top: 15, ticks: [0, 5, 10, 15] });
    expect(niceScale(2400).top).toBe(2500);
  });

  it('keeps counts whole and draws 0 to 4 when there is nothing', () => {
    expect(niceScale(1, { integer: true }).ticks.every(Number.isInteger)).toBe(true);
    expect(niceScale(0)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(null)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
  });
});

describe('labelIndexes', () => {
  it('always labels the first and the last day', () => {
    const picks = labelIndexes(30, 600);
    expect(picks[0]).toBe(0);
    expect(picks.at(-1)).toBe(29);
    expect(picks.length).toBeLessThanOrEqual(7);
    expect(labelIndexes(3, 600)).toEqual([0, 1, 2]);
  });
});

describe('charts', () => {
  const series = [
    { key: 'signups', label: 'New accounts', role: 'people' },
    { key: 'realPosts', label: 'Real posts published', role: 'real' },
  ];

  it('names a bar chart and draws no bar for a zero', () => {
    const { container } = render(
      <BarChart
        label="New accounts and real posts per day"
        series={series}
        points={[
          { day: '2026-11-25', signups: 0, realPosts: 2 },
          { day: '2026-11-26', signups: 1, realPosts: 0 },
        ]}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'New accounts and real posts per day' }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('breaks a line at a missing day instead of drawing a 0', () => {
    const { container } = render(
      <AreaChart
        label="Reach: 3 of 4 days reported"
        points={[
          { day: '2026-11-23', value: 10 },
          { day: '2026-11-24', value: 12 },
          { day: '2026-11-25', value: null },
          { day: '2026-11-26', value: 8 },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Reach: 3 of 4 days reported' })).toBeInTheDocument();
    // One run of two days (a line) and a lone day (a dot), plus the end dot.
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('lists series in a legend named "Legend"', () => {
    render(<Legend items={series} />);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent(
      'New accountsReal posts published',
    );
  });
});
