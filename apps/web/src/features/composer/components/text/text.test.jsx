import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_RULES } from '../../constants/platformRules.js';
import { useAutosizeTextarea } from '../../hooks/useAutosizeTextarea.js';
import { HASHTAG_PLACEMENTS } from '../../model/text.js';
import { ComposerHarness } from '../../test/ComposerHarness.jsx';
import { CaptionEditor } from './CaptionEditor.jsx';
import { CharacterCount, PlatformCounts } from './CharacterCount.jsx';
import { FirstCommentField } from './FirstCommentField.jsx';
import { HashtagEditor } from './HashtagEditor.jsx';
import { KeywordEditor } from './KeywordEditor.jsx';
import { TagInput } from './TagInput.jsx';

vi.mock('sonner', () => ({ toast: vi.fn() }));

const FB = 'FACEBOOK_PAGE';
const IG = 'INSTAGRAM_ACCOUNT';

const tags = (n, prefix = 'tag') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** Renders `ui({ state, dispatch })` on the real composer reducer; `latest()` is the newest state. */
function renderWithComposer(ui, initial) {
  const states = [];
  const view = (renderUi) => (
    <ComposerHarness initial={initial} onState={(state) => states.push(state)}>
      {renderUi}
    </ComposerHarness>
  );
  const utils = render(view(ui));
  return {
    ...utils,
    latest: () => states.at(-1),
    rerenderWith: (nextUi) => utils.rerender(view(nextUi)),
  };
}

/** The last toast's undo action. */
function lastToastAction() {
  const [, options] = vi.mocked(toast).mock.calls.at(-1);
  return options.action;
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
});

/* ------------------------------------------------------------------ CharacterCount */

describe('CharacterCount', () => {
  it('shows "label count/max" and tells screen readers how many characters are left', () => {
    render(<CharacterCount id="count" label="Instagram" count={1500} max={2200} />);
    const counter = document.getElementById('count');
    expect(within(counter).getByText('Instagram')).toBeInTheDocument();
    expect(within(counter).getByText('1,500/2,200')).toBeInTheDocument();
    expect(within(counter).getByText('Instagram: 700 characters left')).toHaveClass('sr-only');
    expect(counter).toHaveAttribute('data-state', 'ok');
  });

  it('turns amber from 90% of the limit, including exactly at the limit', () => {
    const { rerender } = render(
      <CharacterCount id="count" label="Instagram" count={1980} max={2200} />,
    );
    const counter = document.getElementById('count');
    expect(counter).toHaveAttribute('data-state', 'near');
    expect(counter).toHaveClass('text-amber-600');
    expect(screen.getByText('Instagram: 220 characters left')).toBeInTheDocument();

    rerender(<CharacterCount id="count" label="Instagram" count={2200} max={2200} />);
    expect(counter).toHaveAttribute('data-state', 'near');
    expect(screen.getByText('Instagram: 0 characters left')).toBeInTheDocument();

    rerender(<CharacterCount id="count" label="Instagram" count={2199} max={2200} />);
    expect(screen.getByText('Instagram: 1 character left')).toBeInTheDocument();
  });

  it('turns rose and reports how far over the limit the text is', () => {
    render(<CharacterCount id="count" label="Instagram" count={2215} max={2200} />);
    const counter = document.getElementById('count');
    expect(counter).toHaveAttribute('data-state', 'over');
    expect(counter).toHaveClass('text-rose-600');
    expect(within(counter).getByText('2,215/2,200')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 15 characters over the limit')).toBeInTheDocument();
  });

  it('shows just the count when there is no limit', () => {
    render(<CharacterCount id="count" count={1234} max={null} srLabel="Caption" />);
    const counter = document.getElementById('count');
    expect(counter).toHaveAttribute('data-state', 'ok');
    expect(within(counter).getByText('1,234 characters')).toBeInTheDocument();
    expect(within(counter).getByText('Caption: 1,234 characters')).toHaveClass('sr-only');
    expect(counter).not.toHaveTextContent('/');
  });

  it('supports other units such as hashtags', () => {
    render(<CharacterCount count={31} max={30} unit="hashtag" srLabel="Instagram" />);
    expect(screen.getByText('Instagram: 1 hashtag over the limit')).toBeInTheDocument();
  });
});

describe('PlatformCounts', () => {
  it('shows the platform name once and has every counter speak it', () => {
    const { container } = render(
      <PlatformCounts
        platform={IG}
        items={[
          { id: 'ig-chars', unit: 'character', count: 10, max: 2200 },
          { id: 'ig-tags', unit: 'hashtag', count: 3, max: 30 },
          { id: 'ig-mentions', unit: 'mention', count: 0, max: 20 },
        ]}
      />,
    );
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Instagram').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('10/2,200')).toBeInTheDocument();
    expect(screen.getByText('3/30')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 2,190 characters left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 27 hashtags left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 20 mentions left')).toBeInTheDocument();
    expect(container.querySelector('#ig-tags')).toHaveAttribute('data-state', 'ok');
  });
});

/* ------------------------------------------------------------------------ TagInput */

function StatefulTags({ initial = [], ...props }) {
  const [values, setValues] = useState(initial);
  return (
    <TagInput
      label="Tags"
      values={values}
      onAdd={(added) => setValues((current) => [...current, ...added])}
      onRemove={(value) => setValues((current) => current.filter((v) => v !== value))}
      parse={(text) => ({ values: text.split(/[\s,]+/u).filter(Boolean), errors: [] })}
      commitKeys={['Enter', ',', ' ']}
      prefix="#"
      noun="tags"
      max={10}
      hint="Press Enter to add."
      {...props}
    />
  );
}

describe('TagInput', () => {
  it('moves between chips with the arrow keys and removes the focused chip', async () => {
    const user = userEvent.setup();
    render(<StatefulTags initial={['a', 'b', 'c']} />);
    const input = screen.getByRole('textbox', { name: 'Tags' });

    await user.click(input);
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Remove #c' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Remove #b' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowLeft}{Delete}');
    expect(screen.queryByRole('button', { name: 'Remove #b' })).not.toBeInTheDocument();
    // Delete moves focus to the chip that took its place.
    expect(screen.getByRole('button', { name: 'Remove #c' })).toHaveFocus();

    await user.keyboard('{Backspace}');
    // Backspace moves focus to the previous chip.
    expect(screen.getByRole('button', { name: 'Remove #a' })).toHaveFocus();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('keeps all chips behind a single Tab stop (roving tabindex) with Home/End', async () => {
    const user = userEvent.setup();
    render(<StatefulTags initial={['a', 'b', 'c']} />);
    const remove = (v) => screen.getByRole('button', { name: `Remove #${v}` });
    expect([remove('a'), remove('b'), remove('c')].map((b) => b.tabIndex)).toEqual([-1, -1, 0]);

    await user.tab();
    expect(remove('c')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(remove('c')).toHaveFocus();

    await user.keyboard('{Home}');
    expect(remove('a')).toHaveFocus();
    expect([remove('a'), remove('b'), remove('c')].map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    await user.keyboard('{End}');
    expect(remove('c')).toHaveFocus();
  });

  it('returns focus to the input when the last chip is removed', async () => {
    const user = userEvent.setup();
    render(<StatefulTags initial={['only']} />);
    await user.click(screen.getByRole('button', { name: 'Remove #only' }));
    expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveFocus();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('announces additions and removals in a polite live region', async () => {
    const user = userEvent.setup();
    const { container } = render(<StatefulTags />);
    const live = container.querySelector('[aria-live="polite"]');

    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'one two{Enter}');
    expect(live).toHaveTextContent('Added #two');
    await user.click(screen.getByRole('button', { name: 'Remove #one' }));
    expect(live).toHaveTextContent('Removed #one');
  });

  it('commits text that arrives with a separator but no key event (virtual keyboards)', () => {
    render(<StatefulTags />);
    const input = screen.getByRole('textbox', { name: 'Tags' });
    fireEvent.change(input, { target: { value: 'summer ' } });
    expect(screen.getByRole('button', { name: 'Remove #summer' })).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('describes the input with its hint and count, and disables everything when disabled', () => {
    render(<StatefulTags initial={['a']} disabled />);
    const input = screen.getByRole('textbox', { name: 'Tags' });
    expect(input).toHaveAccessibleDescription('Press Enter to add. 1 of 10 tags');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove #a' })).toBeDisabled();
  });
});

/* ------------------------------------------------------------------- HashtagEditor */

const hashtagEditor =
  (platforms = []) =>
  ({ state, dispatch }) => (
    <HashtagEditor state={state} dispatch={dispatch} platforms={platforms} />
  );

describe('HashtagEditor', () => {
  it('commits hashtags on Enter, comma and space and strips the # prefix', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor());
    const input = screen.getByRole('textbox', { name: 'Hashtags' });

    await user.type(input, '#summer{Enter}');
    await user.type(input, 'sale,');
    await user.type(input, 'deals ');

    expect(latest().hashtags).toEqual(['summer', 'sale', 'deals']);
    expect(input).toHaveValue('');
    const list = screen.getByRole('list', { name: 'Hashtags' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['#summer', '#sale', '#deals']);
    expect(screen.getByText('3/60')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('parses a whole pasted list, de-duplicating case-insensitively', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor());
    await user.click(screen.getByRole('textbox', { name: 'Hashtags' }));
    await user.paste('#summer #sale, deals\n#Summer');
    expect(latest().hashtags).toEqual(['summer', 'sale', 'deals']);
  });

  it('ignores hashtags that are already added, without an error', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor(), { hashtags: ['summer'] });
    const input = screen.getByRole('textbox', { name: 'Hashtags' });
    await user.type(input, 'SUMMER{Enter}');
    expect(latest().hashtags).toEqual(['summer']);
    expect(input).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects invalid hashtags in an alert and keeps the text so it can be fixed', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor());
    const input = screen.getByRole('textbox', { name: 'Hashtags' });

    await user.type(input, 'bad-tag{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '#bad-tag can only contain letters, numbers and underscores.',
    );
    expect(input).toHaveValue('bad-tag');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(latest().hashtags).toEqual([]);

    await user.type(input, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets kept invalid text be edited without committing it again on every keystroke', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor());
    const input = screen.getByRole('textbox', { name: 'Hashtags' });
    await user.click(input);
    await user.paste('#a-b #c-d');
    expect(screen.getByRole('alert')).toHaveTextContent('#a-b can only contain');
    expect(input).toHaveValue('#a-b #c-d');

    await user.keyboard('{Backspace}');
    expect(input).toHaveValue('#a-b #c-');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Fixing both and committing adds them.
    await user.clear(input);
    await user.type(input, '#ab #cd{Enter}');
    expect(latest().hashtags).toEqual(['ab', 'cd']);
  });

  it('stops at the maximum and explains why', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor(), { hashtags: tags(59) });
    await user.click(screen.getByRole('textbox', { name: 'Hashtags' }));
    await user.paste('#extra1 #extra2 #extra3');

    expect(latest().hashtags).toHaveLength(60);
    expect(latest().hashtags.at(-1)).toBe('extra1');
    expect(screen.getByRole('alert')).toHaveTextContent('You can add up to 60 hashtags.');
    expect(screen.getByText('60/60')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Hashtags' })).toHaveAttribute(
      'placeholder',
      'Limit of 60 reached',
    );
  });

  it('removes the last hashtag with Backspace in the empty input', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor(), { hashtags: ['summer', 'sale'] });
    await user.click(screen.getByRole('textbox', { name: 'Hashtags' }));
    await user.keyboard('{Backspace}');
    expect(latest().hashtags).toEqual(['summer']);
    expect(screen.getByRole('textbox', { name: 'Hashtags' })).toHaveFocus();
  });

  it('removes one hashtag with its remove button and keeps focus in the chips', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor(), { hashtags: ['summer', 'sale'] });
    await user.click(screen.getByRole('button', { name: 'Remove #summer' }));
    expect(latest().hashtags).toEqual(['sale']);
    expect(screen.getByRole('button', { name: 'Remove #sale' })).toHaveFocus();
  });

  it('commits typed text when the input loses focus', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor());
    await user.type(screen.getByRole('textbox', { name: 'Hashtags' }), 'summer');
    await user.tab();
    expect(latest().hashtags).toEqual(['summer']);
  });

  it('switches hashtag placement through the radiogroup', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor());
    const group = screen.getByRole('radiogroup', { name: 'Hashtag placement' });
    const caption = within(group).getByRole('radio', { name: 'Add to the end of the caption' });
    const comment = within(group).getByRole('radio', { name: 'Add to the first comment' });
    expect(caption).toBeChecked();
    expect(comment).toHaveAccessibleDescription(/first comment instead/);

    await user.click(comment);
    expect(latest().hashtagPlacement).toBe(HASHTAG_PLACEMENTS.FIRST_COMMENT);
    expect(comment).toBeChecked();
    expect(caption).not.toBeChecked();
  });

  it('counts Instagram caption hashtags, including ones typed in the caption', () => {
    renderWithComposer(hashtagEditor([FB, IG]), {
      caption: 'Hello #inline',
      hashtags: ['summer', 'sale'],
    });
    expect(screen.getByText('Instagram: 3 of 30 hashtags in the caption')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Hashtag limits' })).toBeInTheDocument();
  });

  it('shows no hashtag limits when Instagram is not selected', () => {
    renderWithComposer(hashtagEditor([FB]), { hashtags: ['summer'] });
    expect(screen.queryByText(/hashtags in the caption/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Hashtag limits' })).not.toBeInTheDocument();
  });

  it("warns (without an error) past Instagram's advisory hashtag count", () => {
    renderWithComposer(hashtagEditor([IG]), { hashtags: tags(6) });
    const row = screen.getByText('Instagram: 6 of 30 hashtags in the caption').closest('li');
    expect(row).toHaveAttribute('data-state', 'near');
    expect(
      within(row).getByText(
        'Instagram now says posts can use up to 5 hashtags (Instagram Help Center), so some may not work.',
      ),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/over the limit/)).not.toBeInTheDocument();
  });

  it('shows no advisory while Instagram hashtags are within the advised count', () => {
    renderWithComposer(hashtagEditor([IG]), { hashtags: tags(5) });
    const row = screen.getByText('Instagram: 5 of 30 hashtags in the caption').closest('li');
    expect(row).toHaveAttribute('data-state', 'ok');
    expect(screen.queryByText(/now says posts can use/)).not.toBeInTheDocument();
  });

  it('marks an Instagram caption with more than 30 hashtags as over the limit', () => {
    renderWithComposer(hashtagEditor([IG]), { hashtags: tags(31) });
    const row = screen.getByText('Instagram: 31 of 30 hashtags in the caption').closest('li');
    expect(row).toHaveAttribute('data-state', 'over');
    expect(within(row).getByText(/over the limit/)).toBeInTheDocument();
  });

  it('counts Instagram first-comment hashtags when hashtags go in the first comment', () => {
    renderWithComposer(hashtagEditor([IG]), {
      hashtags: tags(6),
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    });
    expect(screen.getByText('Instagram: 0 of 30 hashtags in the caption')).toBeInTheDocument();
    const row = screen.getByText('Instagram: 6 of 5 hashtags in the first comment').closest('li');
    expect(row).toHaveAttribute('data-state', 'over');
  });

  it('clears all hashtags and offers an undo', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(hashtagEditor(), { hashtags: ['summer', 'sale'] });
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(latest().hashtags).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith('Removed 2 hashtags', expect.any(Object));

    const undo = lastToastAction();
    expect(undo.label).toBe('Undo');
    act(() => undo.onClick());
    expect(latest().hashtags).toEqual(['summer', 'sale']);
  });
});

/* ------------------------------------------------------------------- KeywordEditor */

const keywordEditor = ({ state, dispatch }) => <KeywordEditor state={state} dispatch={dispatch} />;

describe('KeywordEditor', () => {
  it('keeps phrases with spaces and commits only on Enter or comma', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(keywordEditor);
    const input = screen.getByRole('textbox', { name: 'SEO keywords' });

    await user.type(input, 'running shoes');
    expect(input).toHaveValue('running shoes');
    expect(latest().keywords).toEqual([]);

    await user.keyboard('{Enter}');
    await user.type(input, 'trail   running,');
    expect(latest().keywords).toEqual(['running shoes', 'trail running']);
    expect(screen.getByRole('button', { name: 'Remove running shoes' })).toBeInTheDocument();
    expect(screen.getByText('2/25')).toBeInTheDocument();
  });

  it('splits a pasted list on commas, semicolons and new lines', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(keywordEditor);
    await user.click(screen.getByRole('textbox', { name: 'SEO keywords' }));
    await user.paste('summer sale; back to school\nshoes, Shoes');
    expect(latest().keywords).toEqual(['summer sale', 'back to school', 'shoes']);
  });

  it('is labelled internal only and never changes the caption', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(keywordEditor, { caption: 'Hello' });
    expect(screen.getByText('Internal only')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'SEO keywords' });
    expect(input).toHaveAccessibleDescription(
      /stored with the post in SocialHub for search and reporting.*never added to captions or sent to Facebook or Instagram/,
    );

    await user.type(input, 'summer sale{Enter}');
    expect(latest().keywords).toEqual(['summer sale']);
    expect(latest().caption).toBe('Hello');
    expect(latest().hashtags).toEqual([]);
  });

  it('reports keywords that are too long', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(keywordEditor);
    await user.click(screen.getByRole('textbox', { name: 'SEO keywords' }));
    await user.paste('x'.repeat(61));
    expect(screen.getByRole('alert')).toHaveTextContent('Keywords can be at most 60 characters.');
    expect(latest().keywords).toEqual([]);
  });
});

/* ------------------------------------------------------------------- CaptionEditor */

const captionEditor =
  (platforms = [FB, IG]) =>
  ({ state, dispatch }) => (
    <CaptionEditor state={state} dispatch={dispatch} platforms={platforms} />
  );

const selectedTab = () =>
  screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');

describe('CaptionEditor', () => {
  it('has an "All platforms" tab and one tab per selected platform', () => {
    renderWithComposer(captionEditor());
    const tablist = screen.getByRole('tablist', { name: 'Caption versions' });
    const [all, facebook, instagram] = within(tablist).getAllByRole('tab');
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
    expect(all).toHaveAccessibleName('All platforms');
    expect(facebook).toHaveAccessibleName('Facebook');
    expect(instagram).toHaveAccessibleName('Instagram');
    expect(screen.getByRole('tab', { name: 'All platforms' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'All platforms' })).toBeInTheDocument();
  });

  it('edits the shared caption with a counter per platform that includes hashtags', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(captionEditor(), { hashtags: ['sale'] });
    const textbox = screen.getByRole('textbox', { name: 'Caption' });
    expect(textbox).toHaveAttribute('placeholder', 'What would you like to share?');

    await user.type(textbox, 'Hello');
    expect(latest().caption).toBe('Hello');
    // "Hello\n\n#sale" = 12 characters.
    expect(screen.getByText('Facebook: 63,194 characters left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 2,188 characters left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 29 hashtags left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 20 mentions left')).toBeInTheDocument();
    expect(screen.getByText('Includes hashtags')).toBeInTheDocument();
    expect(textbox).toHaveAccessibleDescription(/Instagram: 2,188 characters left/);
  });

  it('does not mention hashtags in the counters when they go in the first comment', () => {
    renderWithComposer(captionEditor(), {
      caption: 'Hello',
      hashtags: ['sale'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    });
    expect(screen.getByText('Instagram: 2,195 characters left')).toBeInTheDocument();
    expect(screen.queryByText('Includes hashtags')).not.toBeInTheDocument();
  });

  it('shows a generic count and a hint before any account is chosen', async () => {
    const user = userEvent.setup();
    renderWithComposer(captionEditor([]));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByText("Choose accounts to see each platform's limits")).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Caption' }), 'Hi');
    expect(screen.getByText('2 characters')).toBeInTheDocument();
    expect(screen.getByText('Caption: 2 characters')).toHaveClass('sr-only');
  });

  it('follows the WAI-ARIA tabs keyboard pattern', async () => {
    const user = userEvent.setup();
    renderWithComposer(captionEditor());
    const all = screen.getByRole('tab', { name: 'All platforms' });
    const facebook = screen.getByRole('tab', { name: 'Facebook' });
    const instagram = screen.getByRole('tab', { name: 'Instagram' });
    expect(all).toHaveAttribute('tabindex', '0');
    expect(facebook).toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(all).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(facebook).toHaveFocus();
    expect(selectedTab()).toBe(facebook);
    expect(facebook).toHaveAttribute('tabindex', '0');
    await user.keyboard('{ArrowRight}');
    expect(selectedTab()).toBe(instagram);
    await user.keyboard('{ArrowRight}');
    expect(all).toHaveFocus();
    expect(selectedTab()).toBe(all);
    await user.keyboard('{ArrowLeft}');
    expect(instagram).toHaveFocus();
    await user.keyboard('{Home}');
    expect(selectedTab()).toBe(all);
    await user.keyboard('{End}');
    expect(selectedTab()).toBe(instagram);
    expect(instagram).toHaveFocus();
  });

  it('previews the inherited caption on a platform tab until it is customized', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(captionEditor(), {
      caption: 'Shared text',
      hashtags: ['sale'],
    });
    await user.click(screen.getByRole('tab', { name: 'Instagram' }));
    const panel = screen.getByRole('tabpanel', { name: 'Instagram' });
    expect(within(panel).getByText('Uses the shared caption')).toBeInTheDocument();
    expect(within(panel).getByText(/Shared text/)).toBeInTheDocument();
    expect(within(panel).getByText('#sale')).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument();
    // The read-only preview starts with text, so the panel itself is focusable.
    expect(panel).toHaveAttribute('tabindex', '0');
    // "Shared text\n\n#sale" = 18 characters.
    expect(within(panel).getByText('Instagram: 2,182 characters left')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Customize for Instagram' }));
    expect(latest().platformCaptions[IG]).toBe('Shared text');
    expect(latest().platformCaptions[FB]).toBeNull();
    const custom = screen.getByRole('textbox', { name: 'Instagram caption' });
    expect(custom).toHaveValue('Shared text');
    expect(custom).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Instagram, customized' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex');
  });

  it('edits a customized caption without touching the shared one', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(captionEditor(), {
      caption: 'Shared',
      platformCaptions: { [FB]: null, [IG]: 'IG only' },
    });
    // The shared tab only counts platforms that use the shared caption.
    expect(screen.getByText('Facebook: 63,200 characters left')).toBeInTheDocument();
    expect(screen.queryByText(/Instagram: [\d,]+ characters left/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Instagram uses its own caption, so changes here don't apply to it."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Instagram caption' }));
    expect(selectedTab()).toBe(screen.getByRole('tab', { name: 'Instagram, customized' }));
    const custom = screen.getByRole('textbox', { name: 'Instagram caption' });
    expect(custom).toHaveFocus();

    await user.type(custom, ' more');
    expect(latest().platformCaptions[IG]).toBe('IG only more');
    expect(latest().caption).toBe('Shared');
    expect(screen.getByText('Instagram: 2,188 characters left')).toBeInTheDocument();
    expect(screen.getByText(/use this caption instead of the shared one/)).toBeInTheDocument();
  });

  it('goes back to the shared caption and offers an undo', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(captionEditor(), {
      caption: 'Shared',
      platformCaptions: { [FB]: null, [IG]: 'Custom' },
    });
    await user.click(screen.getByRole('tab', { name: 'Instagram, customized' }));
    await user.click(screen.getByRole('button', { name: 'Use the shared caption' }));

    expect(latest().platformCaptions[IG]).toBeNull();
    expect(screen.getByRole('button', { name: 'Customize for Instagram' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Instagram' })).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      'Instagram uses the shared caption again',
      expect.any(Object),
    );

    act(() => lastToastAction().onClick());
    expect(latest().platformCaptions[IG]).toBe('Custom');
  });

  it('flags a caption over the limit with styling, screen-reader text and a live message', () => {
    const { container } = renderWithComposer(captionEditor([IG]), { caption: 'x'.repeat(2215) });
    const sr = screen.getByText('Instagram: 15 characters over the limit');
    const counter = sr.closest('[data-state]');
    expect(counter).toHaveAttribute('data-state', 'over');
    expect(counter).toHaveClass('text-rose-600');
    expect(screen.getByRole('textbox', { name: 'Caption' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'All platforms, over the limit' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Instagram, over the limit' })).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'The Instagram caption is over the limit.',
    );
  });

  it('counts Instagram @mentions against its limit', () => {
    const mentions = Array.from({ length: 21 }, (_, i) => `@friend${i}`).join(' ');
    renderWithComposer(captionEditor([IG]), { caption: mentions });
    expect(screen.getByText('Instagram: 1 mention over the limit')).toBeInTheDocument();
  });

  it('falls back to "All platforms" when the open platform is no longer selected', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderWithComposer(captionEditor([FB, IG]), { caption: 'Hi' });
    await user.click(screen.getByRole('tab', { name: 'Instagram' }));
    expect(selectedTab()).toHaveAccessibleName('Instagram');

    rerenderWith(captionEditor([FB]));
    expect(screen.queryByRole('tab', { name: 'Instagram' })).not.toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('All platforms');
    expect(screen.getByRole('textbox', { name: 'Caption' })).toHaveValue('Hi');
  });

  it("keeps a customized platform's tab when none of its accounts are selected", async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(captionEditor([FB]), {
      platformCaptions: { [FB]: null, [IG]: 'Kept' },
    });
    await user.click(screen.getByRole('tab', { name: 'Instagram, customized' }));
    expect(
      screen.getByText("No Instagram accounts are selected, so this caption isn't used right now."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use the shared caption' }));
    expect(latest().platformCaptions[IG]).toBeNull();
    expect(screen.queryByRole('tab', { name: /Instagram/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All platforms' })).toHaveFocus();
  });

  it('says when no selected platform uses the shared caption', () => {
    renderWithComposer(captionEditor([IG]), {
      caption: 'Shared',
      platformCaptions: { [FB]: null, [IG]: 'Custom' },
    });
    expect(
      screen.getByText(
        "Every selected platform has its own caption, so this one isn't used right now.",
      ),
    ).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- FirstCommentField */

const firstComment =
  (platforms = [FB, IG]) =>
  ({ state, dispatch }) => (
    <FirstCommentField state={state} dispatch={dispatch} platforms={platforms} />
  );

describe('FirstCommentField', () => {
  it('edits the first comment with counters for each selected platform', async () => {
    const user = userEvent.setup();
    const { latest } = renderWithComposer(firstComment());
    const textbox = screen.getByRole('textbox', { name: 'First comment' });

    await user.type(textbox, 'Thanks!');
    expect(latest().firstComment).toBe('Thanks!');
    expect(screen.getByText('Facebook: 7,993 characters left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 2,193 characters left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 5 hashtags left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 5 mentions left')).toBeInTheDocument();
    expect(textbox).toHaveAccessibleDescription(/Facebook: 7,993 characters left/);
  });

  it('previews the composed comment when hashtags are placed in it', () => {
    renderWithComposer(firstComment([IG]), {
      firstComment: 'Follow us',
      hashtags: ['summer', 'sale'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    });
    const preview = screen.getByRole('figure', { name: 'Hashtags will be added to this comment' });
    expect(within(preview).getByText(/Follow us/)).toHaveTextContent('Follow us #summer #sale');
    // "Follow us\n\n#summer #sale" = 24 characters, 2 hashtags.
    expect(screen.getByText('Instagram: 2,176 characters left')).toBeInTheDocument();
    expect(screen.getByText('Instagram: 3 hashtags left')).toBeInTheDocument();
    expect(screen.getByText('Includes hashtags')).toBeInTheDocument();
  });

  it('shows no hashtag preview while hashtags go in the caption', () => {
    renderWithComposer(firstComment([IG]), { firstComment: 'Hi', hashtags: ['summer'] });
    expect(screen.queryByText('Hashtags will be added to this comment')).not.toBeInTheDocument();
    expect(screen.getByText('Instagram: 2,198 characters left')).toBeInTheDocument();
  });

  it("explains how each platform would post the comment, from the platform's rules", () => {
    const { rerenderWith } = renderWithComposer(firstComment([FB, IG]));
    expect(screen.getByText(PLATFORM_RULES[FB].firstComment.note)).toBeInTheDocument();
    expect(screen.getByText(PLATFORM_RULES[IG].firstComment.note)).toBeInTheDocument();

    rerenderWith(firstComment([]));
    expect(screen.getByText(/Publishing is not available yet/)).toBeInTheDocument();
    expect(screen.queryByText(PLATFORM_RULES[IG].firstComment.note)).not.toBeInTheDocument();
  });

  it('flags a comment over the limit', () => {
    const { container } = renderWithComposer(firstComment([IG]), {
      firstComment: 'x'.repeat(2201),
    });
    expect(screen.getByText('Instagram: 1 character over the limit')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'First comment' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'The Instagram first comment is over the limit.',
    );
  });

  it('shows a generic count and a hint before any account is chosen', async () => {
    const user = userEvent.setup();
    renderWithComposer(firstComment([]));
    await user.type(screen.getByRole('textbox', { name: 'First comment' }), 'Hey');
    expect(screen.getByText('3 characters')).toBeInTheDocument();
    expect(screen.getByText('First comment: 3 characters')).toHaveClass('sr-only');
    expect(screen.getByText("Choose accounts to see each platform's limits")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- useAutosizeTextarea */

function AutosizeProbe({ value, minRows = 2, maxRows = 6, style }) {
  const ref = useRef(null);
  useAutosizeTextarea(ref, value, { minRows, maxRows });
  return <textarea ref={ref} aria-label="Probe" value={value} readOnly style={style} />;
}

const BOX_STYLE = {
  lineHeight: '20px',
  paddingTop: '8px',
  paddingBottom: '8px',
  borderTopWidth: '1px',
  borderBottomWidth: '1px',
  borderStyle: 'solid',
  boxSizing: 'border-box',
};

describe('useAutosizeTextarea', () => {
  let extraLines = 0;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight');

  beforeEach(() => {
    extraLines = 0;
    // jsdom has no layout: model 20px lines plus 16px of padding.
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return (this.value.split('\n').length + extraLines) * 20 + 16;
      },
    });
  });

  afterEach(() => {
    if (descriptor)
      Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', descriptor);
    else delete HTMLTextAreaElement.prototype.scrollHeight;
  });

  it('never goes below minRows', () => {
    render(<AutosizeProbe value="one line" style={BOX_STYLE} />);
    const textarea = screen.getByRole('textbox', { name: 'Probe' });
    // 2 rows × 20px + 16px padding + 2px border.
    expect(textarea.style.height).toBe('58px');
    expect(textarea.style.overflowY).toBe('hidden');
  });

  it('grows with the content and scrolls past maxRows', () => {
    const { rerender } = render(<AutosizeProbe value={'1\n2\n3\n4\n5'} style={BOX_STYLE} />);
    const textarea = screen.getByRole('textbox', { name: 'Probe' });
    expect(textarea.style.height).toBe('118px');
    expect(textarea.style.overflowY).toBe('hidden');

    rerender(<AutosizeProbe value={'1\n2\n3\n4\n5\n6\n7\n8\n9\n10'} style={BOX_STYLE} />);
    // Capped at 6 rows: 120px + 16px + 2px.
    expect(textarea.style.height).toBe('138px');
    expect(textarea.style.overflowY).toBe('auto');

    rerender(<AutosizeProbe value="short again" style={BOX_STYLE} />);
    expect(textarea.style.height).toBe('58px');
  });

  it('re-measures when the window is resized', () => {
    render(<AutosizeProbe value={'1\n2\n3'} style={BOX_STYLE} />);
    const textarea = screen.getByRole('textbox', { name: 'Probe' });
    expect(textarea.style.height).toBe('78px');

    extraLines = 1; // narrower window: the text wraps onto one more line
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(textarea.style.height).toBe('98px');
  });

  it('falls back to minRows when the browser reports no layout', () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 0,
    });
    render(<AutosizeProbe value={'1\n2\n3'} minRows={3} style={{ lineHeight: '20px' }} />);
    expect(screen.getByRole('textbox', { name: 'Probe' }).style.height).toBe('60px');
  });
});
