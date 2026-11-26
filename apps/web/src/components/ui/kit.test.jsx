import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Callout } from './Callout.jsx';
import { Card, CardHeader } from './Card.jsx';
import { EmptyState, RestrictedState } from './Feedback.jsx';
import { Input, PasswordInput, Textarea } from './Field.jsx';
import { PostsArt } from './illustrations.jsx';
import { SectionToneContext } from './sectionTone.js';
import { SegmentedControl } from './SegmentedControl.jsx';
import { SplitBar } from './SplitBar.jsx';
import { StatGrid, StatTile } from './StatTile.jsx';
import { Table, TBody, Td, Th, THead, Tr } from './Table.jsx';
import { TabButtons, TabNav } from './Tabs.jsx';

const inRouter = (ui, path = '/') =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('StatTile', () => {
  it('shows a number, and a dash (never 0) when the value is unknown', () => {
    render(
      <StatGrid label="Platform numbers">
        <StatTile variant="cell" label="Users" value={1280} hint="3 new" />
        <StatTile variant="cell" label="Posts in progress" value={null} />
        <StatTile variant="cell" label="Waiting" value={undefined} unknown="Unknown" />
      </StatGrid>,
    );
    const region = screen.getByRole('region', { name: 'Platform numbers' });
    expect(within(region).getByText('1,280')).toBeInTheDocument();
    expect(within(region).getByText('Posts in progress').parentElement).toHaveTextContent('—');
    expect(within(region).getByText('Unknown')).toBeInTheDocument();
    expect(within(region).queryByText('0')).not.toBeInTheDocument();
  });

  it('prints a formatted string as it is and links the whole tile', () => {
    inRouter(
      <>
        <StatTile label="Success rate" value="93.1%" />
        <StatTile label="Team members" value={4} icon={Users} to="/w/acme/team" />
      </>,
    );
    expect(screen.getByText('93.1%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team members 4' })).toHaveAttribute(
      'href',
      '/w/acme/team',
    );
  });

  it('formats without counting up when animation is off, and hides the hint while loading', () => {
    const { rerender } = render(
      <StatTile
        label="Reach"
        value={2400}
        animate={false}
        format={(n) => `${n / 1000}K`}
        hint="h"
      />,
    );
    expect(screen.getByText('2.4K')).toBeInTheDocument();
    rerender(<StatTile label="Reach" value={2400} loading hint="h" />);
    expect(screen.queryByText('h')).not.toBeInTheDocument();
    expect(screen.queryByText('2,400')).not.toBeInTheDocument();
  });
});

describe('Callout', () => {
  it('has no role unless one is given, and keeps the sentence a direct text node', () => {
    const { container } = render(<Callout title="Data sources.">From our own records.</Callout>);
    expect(container.querySelector('[role]')).toBeNull();
    expect(screen.getByText('From our own records.')).toBeInTheDocument();
    expect(screen.getByText('Data sources.')).toHaveClass('font-semibold');
  });

  it('passes the role and name through', () => {
    render(
      <Callout tone="warning" role="alert" icon={null}>
        Email is not set up.
      </Callout>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Email is not set up.');
  });
});

describe('Tabs', () => {
  it('marks the current route and keeps the count in the link name', () => {
    inRouter(
      <TabNav
        label="Social account sections"
        tabs={[
          { to: '/a', label: 'Overview', end: true },
          { to: '/a/all', label: 'All accounts', count: 12 },
        ]}
      />,
      '/a/all',
    );
    const nav = screen.getByRole('navigation', { name: 'Social account sections' });
    expect(within(nav).getByRole('link', { name: /All accounts/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: /^All accounts ?12$/ })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('switches a state filter with pressed buttons named "Label (count)"', async () => {
    const onChange = vi.fn();
    render(
      <TabButtons
        label="Show posts by status"
        value="all"
        onChange={onChange}
        tabs={[
          { key: 'all', label: 'All', count: 3 },
          { key: 'failed', label: 'Failed', count: 1, attention: 'danger' },
          { key: 'drafts', label: 'Drafts' },
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Show posts by status' });
    expect(within(group).getByRole('button', { name: 'All (3)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: 'Drafts' })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'Failed (1)' }));
    expect(onChange).toHaveBeenCalledWith('failed');
  });
});

describe('SegmentedControl', () => {
  it('uses pressed buttons by default and reports only real changes', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Accounts to show"
        value="ws"
        onChange={onChange}
        options={[
          ['ws', 'This workspace'],
          ['all', 'All my workspaces'],
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Accounts to show' });
    await userEvent.click(within(group).getByRole('button', { name: 'This workspace' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(group).getByRole('button', { name: 'All my workspaces' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('moves with the arrow keys as a radio group, with one tab stop', () => {
    function Demo() {
      const [value, setValue] = useState('live');
      return (
        <SegmentedControl
          label="Publishing mode"
          model="radio"
          value={value}
          onChange={setValue}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'sim', label: 'Simulated' },
          ]}
        />
      );
    }
    render(<Demo />);
    const live = screen.getByRole('radio', { name: 'Live' });
    const sim = screen.getByRole('radio', { name: 'Simulated' });
    expect(live).toHaveAttribute('aria-checked', 'true');
    expect(live).toHaveAttribute('tabindex', '0');
    expect(sim).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(live, { key: 'ArrowRight' });
    expect(sim).toHaveAttribute('aria-checked', 'true');
    expect(sim).toHaveFocus();
  });
});

describe('empty and restricted states', () => {
  it('draws the art instead of the chip and keeps the heading', () => {
    const { container } = render(
      <EmptyState art={PostsArt} title="No posts yet" description="Nothing here." />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'No posts yet' })).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('puts a restricted state in a card', () => {
    render(<RestrictedState title="Activity is restricted" description="Ask an owner." />);
    const heading = screen.getByRole('heading', { name: 'Activity is restricted' });
    expect(heading.closest('section')).not.toBeNull();
  });
});

describe('Card', () => {
  it('tints the icon chip with the section, unless told otherwise', () => {
    const { container } = render(
      <SectionToneContext.Provider value={{ soft: 'sky' }}>
        <Card>
          <CardHeader icon={Users} title="Members" />
        </Card>
        <Card>
          <CardHeader icon={Users} iconTone="danger" title="Danger zone" />
        </Card>
      </SectionToneContext.Provider>,
    );
    const chips = container.querySelectorAll('h2');
    expect(chips).toHaveLength(2);
    expect(container.innerHTML).toContain('bg-sky-50');
    expect(container.innerHTML).toContain('bg-rose-50');
  });
});

describe('Table', () => {
  it('is a captioned table with column and row headers', () => {
    render(
      <Table caption="Users">
        <THead>
          <Th>Person</Th>
          <Th align="right">Workspaces</Th>
        </THead>
        <TBody>
          <Tr>
            <Td header>Ada</Td>
            <Td numeric>2</Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Users' });
    expect(within(table).getByRole('columnheader', { name: 'Workspaces' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Ada' })).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('joins its own message with ids the caller passes', () => {
    render(
      <>
        <p id="rules">Rules</p>
        <Input label="Name" hint="Shown to teammates." aria-describedby="rules" />
      </>,
    );
    const input = screen.getByLabelText('Name');
    const ids = input.getAttribute('aria-describedby').split(' ');
    expect(ids).toContain('rules');
    expect(ids).toHaveLength(2);
    expect(input).toHaveAccessibleDescription('Shown to teammates. Rules');
  });

  it('puts the label action after the control in the tab order when asked', async () => {
    render(
      <PasswordInput
        label="Password"
        labelActionLast
        labelAction={<a href="/forgot-password">Forgot password?</a>}
      />,
    );
    await userEvent.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveFocus();
  });

  it('offers a labelled textarea with the error wiring', () => {
    render(<Textarea label="Reason" error="Write at least 10 characters" />);
    const area = screen.getByLabelText('Reason');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Write at least 10 characters');
  });
});

describe('SplitBar', () => {
  it('names the parts and draws nothing for a zero part', () => {
    render(
      <SplitBar
        data-testid="split"
        label="Facebook Pages 100%"
        parts={[
          { key: 'fb', label: 'Facebook', value: 3, className: 'bg-[#1877f2]' },
          { key: 'ig', label: 'Instagram', value: 0, className: 'bg-[#d62976]' },
        ]}
      />,
    );
    const bar = screen.getByRole('img', { name: 'Facebook Pages 100%' });
    expect(bar).toHaveAttribute('data-testid', 'split');
    expect(bar.querySelectorAll('[title]')).toHaveLength(1);
  });

  it('is a hidden empty track when nothing is counted', () => {
    render(<SplitBar label="nothing" parts={[]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
