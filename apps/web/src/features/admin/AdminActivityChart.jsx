import { useState } from 'react';
import { BarChart } from '../../components/charts/BarChart.jsx';
import { ChartFrame, Legend } from '../../components/charts/ChartFrame.jsx';
import { formatChartDay } from '../../components/charts/scale.js';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { InsightsArt } from '../../components/ui/illustrations.jsx';
import { TBody, THead, Table, Td, Th, Tr } from '../../components/ui/Table.jsx';
import { formatCount, plural } from './adminFormat.js';

// New accounts are people (teal), real posts the indigo of every real figure. Simulated posts
// never share this chart (palette.js); they are in the table.
const SERIES = [
  { key: 'signups', label: 'New accounts', role: 'people' },
  { key: 'realPosts', label: 'Real posts published', role: 'real' },
];

const sum = (days, key) => days.reduce((total, day) => total + (day[key] ?? 0), 0);

/** The overview's last 14 days (UTC): a bar chart of two series, with a table view. */
export function AdminActivityChart({ days }) {
  const [table, setTable] = useState(false);
  const signups = sum(days, 'signups');
  const realPosts = sum(days, 'realPosts');

  if (signups === 0 && realPosts === 0 && !table) {
    return (
      <EmptyState
        layout="inline"
        art={InsightsArt}
        title="A quiet two weeks"
        description="No new accounts and no real posts in the last 14 days."
        action={
          <button
            type="button"
            onClick={() => setTable(true)}
            className="text-sm font-medium text-brand-600 hover:text-brand-500 dark:text-brand-300"
          >
            Show the days as a table
          </button>
        }
      />
    );
  }

  return (
    <ChartFrame
      title="Per day"
      note={`${plural(signups, 'new account', 'new accounts')}, ${plural(realPosts, 'real post', 'real posts')}`}
      legend={<Legend items={SERIES} />}
      table={table}
      onToggleTable={() => setTable((shown) => !shown)}
    >
      {table ? (
        <div className="-mx-5 sm:-mx-6">
          <Table caption="Activity per day" minWidth="min-w-[560px]" stickyFirst>
            <THead>
              <Th>Day</Th>
              <Th align="right">New accounts</Th>
              <Th align="right">New workspaces</Th>
              <Th align="right">Real posts</Th>
              <Th align="right">Simulated posts</Th>
              <Th align="right">Failed posts</Th>
            </THead>
            <TBody>
              {[...days].reverse().map((day) => (
                <Tr key={day.day}>
                  <Td header className="whitespace-nowrap text-slate-900 dark:text-white">
                    {formatChartDay(day.day, true)}
                  </Td>
                  <Td numeric>{formatCount(day.signups)}</Td>
                  <Td numeric>{formatCount(day.workspaces)}</Td>
                  <Td numeric>{formatCount(day.realPosts)}</Td>
                  <Td numeric>{formatCount(day.simulatedPosts)}</Td>
                  <Td numeric>{formatCount(day.failedPosts)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <BarChart
          points={days}
          series={SERIES}
          height={220}
          label="New accounts and real posts per day, last 14 days"
        />
      )}
    </ChartFrame>
  );
}
