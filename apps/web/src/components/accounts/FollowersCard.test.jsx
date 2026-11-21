import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AccountsTable } from './AccountsTable.jsx';
import { FollowersCard } from './FollowersCard.jsx';

const followers = (overrides = {}) => ({
  total: 5456,
  facebook: 2000,
  instagram: 3456,
  counted: 3,
  missing: 0,
  facebookMissing: 0,
  instagramMissing: 0,
  asOf: new Date(Date.now() - 3_600_000).toISOString(),
  ...overrides,
});

describe('FollowersCard', () => {
  it('shows the combined total with the Facebook and Instagram split', () => {
    render(<FollowersCard followers={followers()} />);
    expect(screen.getByTestId('followers-total')).toHaveTextContent('5,456');
    const facebook = screen.getByText('Facebook Pages').closest('div');
    expect(within(facebook).getByText('2,000')).toBeInTheDocument();
    const instagram = screen.getByText('Instagram accounts').closest('div');
    expect(within(instagram).getByText('3,456')).toBeInTheDocument();
    expect(screen.getByText(/counted once per account/)).toBeInTheDocument();
    expect(screen.getByText(/As of/)).toBeInTheDocument();
  });

  it('abbreviates large totals but keeps the exact figure in the title', () => {
    render(<FollowersCard followers={followers({ total: 1_234_567, instagram: 1_232_567 })} />);
    const total = screen.getByTestId('followers-total');
    expect(total).toHaveTextContent('1.2M');
    expect(total).toHaveAttribute('title', '1,234,567 followers');
  });

  it('shows unknown counts as "—", never 0, and says which accounts are left out', () => {
    render(
      <FollowersCard
        followers={followers({
          total: 2000,
          instagram: null,
          counted: 1,
          missing: 2,
          instagramMissing: 2,
        })}
      />,
    );
    const instagram = screen.getByText('Instagram accounts').closest('div');
    expect(within(instagram).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByText(/2 accounts have no follower count from Meta yet/)).toBeInTheDocument();
  });

  it('explains when Meta has not returned any count yet', () => {
    render(
      <FollowersCard
        followers={followers({
          total: null,
          facebook: null,
          instagram: null,
          counted: 0,
          missing: 1,
          facebookMissing: 1,
          asOf: null,
        })}
      />,
    );
    expect(screen.getByTestId('followers-total')).toHaveTextContent('—');
    expect(screen.getByText(/No follower counts yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('followers-split')).not.toBeInTheDocument();
  });

  it('splits the total between Facebook and Instagram and says which accounts it covers', () => {
    render(
      <FollowersCard
        followers={followers()}
        accounts={{ total: 3, facebookPages: 1, instagramAccounts: 2 }}
      />,
    );
    const split = screen.getByTestId('followers-split');
    expect(split).toHaveAttribute('aria-label', 'Facebook Pages 37%, Instagram accounts 63%');
    expect(
      within(screen.getByTestId('followers-facebook')).getByText('Across 1 Page'),
    ).toBeVisible();
    expect(
      within(screen.getByTestId('followers-instagram')).getByText('Across 2 accounts'),
    ).toBeVisible();
  });

  it('says how many accounts were counted when some have no count', () => {
    render(
      <FollowersCard
        followers={followers({ total: 2000, instagram: null, missing: 2, instagramMissing: 2 })}
        accounts={{ total: 4, facebookPages: 1, instagramAccounts: 3 }}
      />,
    );
    expect(
      within(screen.getByTestId('followers-instagram')).getByText('1 of 3 accounts counted'),
    ).toBeVisible();
    // Only Facebook has a known count, so the bar shows a single segment.
    expect(screen.getByTestId('followers-split')).toHaveAttribute(
      'aria-label',
      'Facebook Pages 100%',
    );
  });

  it('stays visible with no accounts and shows the empty action', () => {
    render(
      <FollowersCard
        followers={followers({
          total: null,
          facebook: null,
          instagram: null,
          counted: 0,
          asOf: null,
        })}
        accounts={{ total: 0, facebookPages: 0, instagramAccounts: 0 }}
        emptyAction={<button type="button">Connect accounts</button>}
      />,
    );
    expect(screen.getByTestId('followers-total')).toHaveTextContent('—');
    expect(screen.getByText(/No Facebook Pages or Instagram accounts are available/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect accounts' })).toBeVisible();
    expect(screen.getByText('No Pages yet')).toBeVisible();
    expect(screen.queryByText(/No follower counts yet/)).not.toBeInTheDocument();
  });
});

describe('AccountsTable followers column', () => {
  it('shows each account’s count, or "—" when Meta returned none', () => {
    const base = {
      platform: 'FACEBOOK_PAGE',
      health: { readiness: 'READY', connectionStatus: 'ACTIVE', attention: [] },
    };
    render(
      <MemoryRouter>
        <AccountsTable
          caption="Accounts"
          columns={['account', 'followers']}
          items={[
            { ...base, id: 'a', externalId: '1', name: 'Known', followersCount: 12_931 },
            { ...base, id: 'b', externalId: '2', name: 'Unknown', followersCount: null },
          ]}
        />
      </MemoryRouter>,
    );
    const [, known, unknown] = screen.getAllByRole('row');
    expect(within(known).getByText('12.9K')).toBeInTheDocument();
    expect(within(unknown).getByText('—')).toBeInTheDocument();
  });
});
