import { SOCIAL_PLATFORMS } from '@socialhub/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeAccounts } from '../../model/accounts.js';
import {
  INSPECTION_STATUS,
  MEDIA_KINDS,
  createInitialComposerState,
  createMediaItem,
} from '../../model/composerState.js';
import { HASHTAG_PLACEMENTS, extractHashtags, extractMentions } from '../../model/text.js';
import { SEVERITY, validateComposer } from '../../model/validation.js';
import { accountList } from '../../test/fixtures.js';
import { FacebookPostPreview } from './FacebookPostPreview.jsx';
import { InstagramPostPreview } from './InstagramPostPreview.jsx';
import { PreviewText } from './PreviewText.jsx';
import { PublishingPreview } from './PublishingPreview.jsx';
import { ReadinessPanel } from './ReadinessPanel.jsx';

const FB = SOCIAL_PLATFORMS.FACEBOOK_PAGE;
const IG = SOCIAL_PLATFORMS.INSTAGRAM_ACCOUNT;

const accounts = normalizeAccounts(accountList());
const accountById = (id) => accounts.find((a) => a.id === id);
const store = accountById('acc-fb-1'); // Facebook Page "Acme Store"
const outlet = accountById('acc-fb-2'); // Facebook Page "Acme Outlet"
const acmeInstagram = accountById('acc-ig-1'); // Instagram "Acme Instagram" (@acme)
const studio = accountById('acc-ig-2'); // Instagram "Acme Studio": publishing access restricted

function mediaItem({
  id = 'm1',
  kind = MEDIA_KINDS.IMAGE,
  width = 1080,
  height = 1080,
  ...rest
} = {}) {
  const isVideo = kind === MEDIA_KINDS.VIDEO;
  return {
    ...createMediaItem({
      id,
      kind,
      fileName: rest.fileName ?? `${id}.${isVideo ? 'mp4' : 'jpg'}`,
      mimeType: rest.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
      sizeBytes: rest.sizeBytes ?? 500_000,
      previewUrl: 'previewUrl' in rest ? rest.previewUrl : `blob:mock/${id}`,
    }),
    width,
    height,
    inspection: width && height ? INSPECTION_STATUS.DONE : INSPECTION_STATUS.FAILED,
    altText: rest.altText ?? '',
  };
}

const mediaList = (count, overrides = {}) =>
  Array.from({ length: count }, (_, i) => mediaItem({ id: `m${i + 1}`, ...overrides }));

const composer = (overrides = {}) => ({ ...createInitialComposerState(), ...overrides });

const tokensIn = (container) =>
  [...container.querySelectorAll('[data-token]')].map((node) => [
    node.dataset.token,
    node.textContent,
  ]);

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- PreviewText */

describe('PreviewText', () => {
  it('highlights hashtags, mentions and links as separate nodes without injecting HTML', () => {
    const text = 'Hi #summer, thanks @acme.\nShop https://acme.com/sale. <b>not bold</b>';
    const { container } = render(<PreviewText text={text} platform={FB} />);

    expect(tokensIn(container)).toEqual([
      ['hashtag', '#summer'],
      ['mention', '@acme'],
      ['url', 'https://acme.com/sale'],
    ]);
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<b>not bold</b>');
    const root = container.firstChild;
    expect(root).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(root.textContent).toContain('@acme.\nShop');
  });

  it('highlights exactly the hashtags and mentions the counters count', () => {
    const text = 'Hi #summer #été and https://acme.com/#top &#38; a#b #_ok @acme @x.y';
    const { container } = render(<PreviewText text={text} platform={FB} collapsedChars={null} />);
    const tokens = tokensIn(container);

    const hashtags = tokens.filter(([type]) => type === 'hashtag').map(([, v]) => v.slice(1));
    const mentions = tokens.filter(([type]) => type === 'mention').map(([, v]) => v.slice(1));
    expect(hashtags).toEqual(extractHashtags(text));
    expect(mentions).toEqual(extractMentions(text));
    expect(tokens).toContainEqual(['url', 'https://acme.com/#top']);
  });

  it('keeps links as plain text on Instagram, which does not link them in captions', () => {
    const { container } = render(
      <PreviewText text="New drop https://acme.com #sale @acme" platform={IG} />,
    );
    expect(tokensIn(container)).toEqual([
      ['hashtag', '#sale'],
      ['mention', '@acme'],
    ]);
    expect(container).toHaveTextContent('https://acme.com');
  });

  it('collapses long Facebook text behind "See more" and expands it', async () => {
    const user = userEvent.setup();
    const text = `${'word '.repeat(119)}finale`;
    const { container } = render(
      <PreviewText text={text} platform={FB} collapsedChars={480} subject="caption" />,
    );

    const toggle = screen.getByRole('button', { name: 'See more of the caption' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container).not.toHaveTextContent('finale');
    expect(container.textContent).toMatch(/word… See more/);
    expect(container.textContent.split('…')[0].length).toBeLessThanOrEqual(480);

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'See less of the caption' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(container).toHaveTextContent('finale');
  });

  it('uses Instagram\'s "more" and its two-line limit', async () => {
    const user = userEvent.setup();
    render(<PreviewText text={'Line one\nLine two\nLine three'} platform={IG} />);

    expect(screen.queryByText(/Line three/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByText(/Line three/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'less' })).toBeInTheDocument();
  });

  it('never splits an emoji when collapsing', () => {
    const family = '👩‍👩‍👧';
    const { container } = render(
      <PreviewText text={`${'a'.repeat(124)}${family} end`} platform={IG} collapsedLines={null} />,
    );
    expect(container.textContent).toContain(`${family}… more`);
  });

  it('shows short text in full and renders nothing for empty text', () => {
    const { container, rerender } = render(<PreviewText text="Short and sweet" platform={FB} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('Short and sweet');

    rerender(<PreviewText text="" platform={FB} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/* -------------------------------------------------------- FacebookPostPreview */

describe('FacebookPostPreview', () => {
  it('shows the Page with "Preview" in place of a time, and decorative actions only', () => {
    render(<FacebookPostPreview account={store} caption="Hello #world" media={[]} />);
    const post = screen.getByRole('article', { name: 'Facebook post preview for Acme Store' });

    expect(within(post).getByText('Acme Store')).toBeInTheDocument();
    expect(within(post).getByText('Preview')).toBeInTheDocument();
    expect(within(post).getByText('#world')).toHaveAttribute('data-token', 'hashtag');
    expect(post).not.toHaveTextContent(/just now|ago|published|likes?\s*\d/i);
    expect(within(post).getByText('Like').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(post).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    [1, 'single'],
    [2, 'pair'],
    [3, 'trio'],
    [4, 'grid'],
  ])('lays out %i item(s) as "%s"', (count, layout) => {
    const { container } = render(
      <FacebookPostPreview account={store} caption="" media={mediaList(count)} />,
    );
    expect(container.querySelector('[data-layout]')).toHaveAttribute('data-layout', layout);
    expect(container.querySelectorAll('img')).toHaveLength(count);
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it('shows four tiles with "+2" on the last one for five items', () => {
    const { container } = render(<FacebookPostPreview account={store} media={mediaList(5)} />);

    expect(container.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'grid');
    expect(container.querySelectorAll('img')).toHaveLength(4);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('2 more')).toHaveClass('sr-only');
    expect(screen.getByText('Media: 5 photos')).toHaveClass('sr-only');
  });

  it('puts a portrait first item on the left of the three-item layout', () => {
    const media = [mediaItem({ id: 'tall', width: 1080, height: 1350 }), ...mediaList(2)];
    const { container } = render(<FacebookPostPreview account={store} media={media} />);
    const firstTile = container.querySelector('[data-layout="trio"] img').parentElement;
    expect(firstTile).toHaveClass('row-span-2');
  });

  it("shows a video's first frame with a play badge and falls back when it can't be shown", () => {
    const video = mediaItem({ id: 'v1', kind: MEDIA_KINDS.VIDEO, width: 1920, height: 1080 });
    const { container } = render(
      <FacebookPostPreview account={store} caption="Watch this" media={[video]} />,
    );

    const element = container.querySelector('video');
    expect(element).toHaveAttribute('preload', 'metadata');
    expect(element).not.toHaveAttribute('controls');
    expect(element.muted).toBe(true);
    expect(screen.getByText('Media: 1 video')).toBeInTheDocument();
    expect(container.querySelector('.lucide-play')).not.toBeNull();

    // A server-stored video's preview URL may be a poster image rather than the video.
    fireEvent.error(element);
    const poster = container.querySelector('img');
    expect(poster).toHaveAttribute('src', 'blob:mock/v1');

    fireEvent.error(poster);
    expect(container.querySelector('[data-media-placeholder]')).toHaveTextContent('v1.mp4');
  });

  it('shows a placeholder tile for a file without a preview URL', () => {
    const media = [mediaItem({ id: 'scan', fileName: 'scan.jpg', previewUrl: null })];
    const { container } = render(<FacebookPostPreview account={store} media={media} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('scan.jpg')).toBeInTheDocument();
    expect(screen.getByText('No preview available')).toBeInTheDocument();
  });

  it('renders the first comment as a comment from the Page', () => {
    render(
      <FacebookPostPreview account={store} caption="Hi" firstComment="First! #launch" media={[]} />,
    );
    const comment = screen.getByRole('group', { name: 'First comment' });
    expect(within(comment).getByText('Acme Store')).toBeInTheDocument();
    expect(within(comment).getByText('#launch')).toHaveAttribute('data-token', 'hashtag');
    expect(within(comment).getByText('Preview')).toBeInTheDocument();
  });

  it('shows a sample Page and a muted placeholder when there is nothing to show', () => {
    render(<FacebookPostPreview caption="" media={[]} />);
    expect(
      screen.getByRole('article', { name: 'Facebook post preview for Your Page' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Write a caption or add a photo or video to see it here.'),
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- InstagramPostPreview */

describe('InstagramPostPreview', () => {
  it('navigates the carousel with real controls', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <InstagramPostPreview account={acmeInstagram} caption="Swipe" media={mediaList(3)} />,
    );
    const carousel = screen.getByRole('group', { name: 'Post media' });
    const previous = within(carousel).getByRole('button', { name: 'Previous slide' });
    const next = within(carousel).getByRole('button', { name: 'Next slide' });
    const track = container.querySelector('[data-slide-track]');

    expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
    expect(within(carousel).getByText('1/3')).toBeInTheDocument();
    expect(previous).toHaveAttribute('aria-disabled', 'true');

    await user.click(next);
    expect(within(carousel).getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Slide 2 of 3')).toBeInTheDocument();
    expect(track.style.transform).toBe('translateX(-100%)');
    const slides = carousel.querySelectorAll('[aria-roledescription="slide"]');
    expect(slides[0]).toHaveAttribute('aria-hidden', 'true');
    expect(slides[1]).not.toHaveAttribute('aria-hidden');
    expect(previous).not.toHaveAttribute('aria-disabled');

    await user.click(next);
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await user.click(next);
    expect(within(carousel).getByText('3/3')).toBeInTheDocument();

    await user.click(previous);
    expect(within(carousel).getByText('2/3')).toBeInTheDocument();
  });

  it('keeps the current slide in range when media is removed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <InstagramPostPreview account={acmeInstagram} media={mediaList(3)} />,
    );
    await user.click(screen.getByRole('button', { name: 'Next slide' }));
    await user.click(screen.getByRole('button', { name: 'Next slide' }));

    rerender(<InstagramPostPreview account={acmeInstagram} media={mediaList(2)} />);
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it.each([
    ['a tall first item', { width: 1000, height: 2000 }, '0.8 / 1'],
    ['a wide first item', { width: 3000, height: 1000 }, '1.91 / 1'],
    ['an in-range first item', { width: 1200, height: 1000 }, '1.2 / 1'],
    ['a first item of unknown size', { width: null, height: null }, '1 / 1'],
  ])('frames every slide like %s, clamped to Instagram’s range', (_, size, expected) => {
    const media = [mediaItem({ id: 'a', ...size }), mediaItem({ id: 'b' })];
    const { container } = render(<InstagramPostPreview account={acmeInstagram} media={media} />);
    expect(container.querySelector('[data-preview-frame]').style.aspectRatio).toBe(expected);
    expect(container.querySelectorAll('img.object-cover')).toHaveLength(2);
  });

  it('shows a single video like a Reel: 9:16 and letterboxed', () => {
    const video = mediaItem({ id: 'v', kind: MEDIA_KINDS.VIDEO, width: 1920, height: 1080 });
    const { container } = render(<InstagramPostPreview account={acmeInstagram} media={[video]} />);
    expect(container.querySelector('[data-preview-frame]').style.aspectRatio).toBe('9 / 16');
    expect(container.querySelector('video')).toHaveClass('object-contain');
    expect(screen.queryByRole('group', { name: 'Post media' })).not.toBeInTheDocument();
  });

  it('asks for a photo or video when there is no media, with a sample account', () => {
    render(<InstagramPostPreview caption="Hello" media={[]} />);
    const post = screen.getByRole('article', { name: 'Instagram post preview for your_account' });
    expect(within(post).getByText('Instagram posts need a photo or video')).toBeInTheDocument();
  });

  it('puts the username before the caption and collapses it around 125 characters', () => {
    render(
      <InstagramPostPreview
        account={acmeInstagram}
        caption={`${'Sunny days '.repeat(15)}finale`}
        media={mediaList(1)}
      />,
    );
    const post = screen.getByRole('article', { name: 'Instagram post preview for acme' });
    expect(within(post).getAllByText('acme')).toHaveLength(2);
    expect(within(post).getByRole('button', { name: 'more of the caption' })).toBeInTheDocument();
    expect(post).not.toHaveTextContent('finale');
    expect(within(post).getByText('Preview')).toBeInTheDocument();
  });

  it('reveals the first comment behind "View 1 comment"', async () => {
    const user = userEvent.setup();
    render(
      <InstagramPostPreview
        account={acmeInstagram}
        caption="Hi"
        firstComment="#tag1 #tag2"
        media={mediaList(1)}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'View 1 comment' });
    const comment = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(comment).not.toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(comment).toBeVisible();
    expect(comment).toHaveTextContent('acme #tag1 #tag2');
  });
});

/* ---------------------------------------------------------- PublishingPreview */

describe('PublishingPreview', () => {
  it('is labelled "Not published" and approximate, and makes no requests', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<PublishingPreview state={composer({ caption: 'Big news' })} accounts={[store]} />);

    const card = screen.getByRole('region', { name: 'Preview' });
    expect(within(card).getByText('Not published')).toBeInTheDocument();
    expect(
      within(card).getByText('Approximate. Facebook and Instagram may display it differently.'),
    ).toBeInTheDocument();
    expect(card.textContent.replace('Not published', '')).not.toMatch(
      /published|posted|scheduled|just now|ready to publish/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('switches between the selected destinations', async () => {
    const user = userEvent.setup();
    const state = composer({ caption: 'Launch day', media: mediaList(1) });
    render(<PublishingPreview state={state} accounts={[store, acmeInstagram]} />);

    const storeButton = screen.getByRole('button', { name: 'Acme Store, Facebook' });
    const instagramButton = screen.getByRole('button', { name: 'Acme Instagram, Instagram' });
    expect(storeButton).toHaveAttribute('aria-pressed', 'true');
    expect(instagramButton).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('article', { name: 'Facebook post preview for Acme Store' }),
    ).toBeInTheDocument();

    await user.click(instagramButton);
    expect(instagramButton).toHaveAttribute('aria-pressed', 'true');
    expect(storeButton).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('article', { name: 'Instagram post preview for acme' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Facebook/ })).not.toBeInTheDocument();
  });

  it('falls back to the first account when the previewed one is deselected', async () => {
    const user = userEvent.setup();
    const state = composer({ caption: 'Launch day' });
    const { rerender } = render(
      <PublishingPreview state={state} accounts={[store, acmeInstagram]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Acme Instagram, Instagram' }));

    rerender(<PublishingPreview state={state} accounts={[outlet, store]} />);
    expect(screen.getByRole('button', { name: 'Acme Outlet, Facebook' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('article', { name: 'Facebook post preview for Acme Outlet' }),
    ).toBeInTheDocument();
  });

  it('marks destinations that need attention', () => {
    render(<PublishingPreview state={composer({ caption: 'Hi' })} accounts={[studio]} />);
    expect(
      screen.getByRole('button', { name: 'Acme Studio, Instagram, needs attention' }),
    ).toBeInTheDocument();
  });

  it('offers a Facebook / Instagram toggle with a sample account when none are selected', async () => {
    const user = userEvent.setup();
    render(<PublishingPreview state={composer({ caption: 'Hello' })} accounts={[]} />);

    expect(screen.getByRole('button', { name: 'Facebook' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('article', { name: 'Facebook post preview for Your Page' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A sample account is shown/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Instagram' }));
    expect(screen.getByRole('button', { name: 'Instagram' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('article', { name: 'Instagram post preview for your_account' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Instagram posts need a photo or video')).toBeInTheDocument();
  });

  it('shows an empty state until there is a caption or media', () => {
    render(<PublishingPreview state={composer()} accounts={[store]} />);
    expect(screen.getByText('Your preview appears here')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it("previews each platform's exact composed caption", async () => {
    const user = userEvent.setup();
    const state = composer({
      caption: 'Shared caption',
      platformCaptions: { [FB]: 'Facebook only caption', [IG]: null },
      hashtags: ['summer', 'sale'],
      media: mediaList(1),
    });
    render(<PublishingPreview state={state} accounts={[store, acmeInstagram]} />);

    const facebook = screen.getByRole('article', { name: /Facebook post preview/ });
    expect(facebook).toHaveTextContent('Facebook only caption #summer #sale');
    expect(facebook).not.toHaveTextContent('Shared caption');

    await user.click(screen.getByRole('button', { name: 'Acme Instagram, Instagram' }));
    expect(screen.getByRole('article', { name: /Instagram post preview/ })).toHaveTextContent(
      'acme Shared caption',
    );
  });

  it('moves hashtags into the first comment when that placement is chosen', () => {
    const state = composer({
      caption: 'Hello',
      firstComment: 'Details below',
      hashtags: ['launch'],
      hashtagPlacement: HASHTAG_PLACEMENTS.FIRST_COMMENT,
    });
    render(<PublishingPreview state={state} accounts={[store]} />);

    const comment = screen.getByRole('group', { name: 'First comment' });
    expect(comment).toHaveTextContent('Details below #launch');
    expect(screen.getAllByText('#launch')).toHaveLength(1);
  });

  it('notes platform behaviour the preview cannot show', () => {
    const tall = mediaList(3, { width: 1000, height: 2000 });
    const { rerender } = render(
      <PublishingPreview
        state={composer({ caption: 'Shop https://acme.com', media: tall })}
        accounts={[acmeInstagram]}
      />,
    );
    expect(screen.getByText("Instagram doesn't make links in captions clickable.")).toBeVisible();
    expect(
      screen.getByText('Instagram crops every slide to the shape of the first one (4:5).'),
    ).toBeInTheDocument();

    rerender(
      <PublishingPreview
        state={composer({ caption: 'Read https://acme.com/blog' })}
        accounts={[store]}
      />,
    );
    expect(
      screen.getByText("Facebook may show a preview card for the first link. It isn't shown here."),
    ).toBeInTheDocument();
  });

  it('shows a skeleton while accounts load and a sample account if they fail', () => {
    const state = composer({ caption: 'Hi' });
    const { rerender } = render(<PublishingPreview state={state} accounts={[]} status="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Facebook' })).not.toBeInTheDocument();

    rerender(<PublishingPreview state={state} accounts={[]} status="error" />);
    expect(
      screen.getByText("Your accounts couldn't be loaded, so a sample account is shown."),
    ).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /Your Page/ })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- ReadinessPanel */

describe('ReadinessPanel', () => {
  const tallPng = (id) =>
    mediaItem({
      id,
      fileName: `${id}.png`,
      mimeType: 'image/png',
      width: 1000,
      height: 2000,
      sizeBytes: 1_000_000,
    });

  it('groups issues into General, each platform and each account, with counts', () => {
    const state = composer({
      caption: 'Hello',
      selectedAccountIds: ['acc-fb-1', 'acc-ig-2', 'acc-gone'],
      media: [tallPng('photo')],
    });
    render(<ReadinessPanel validation={validateComposer(state, accounts)} accounts={accounts} />);
    const panel = screen.getByRole('region', { name: 'Readiness check' });

    const summary = within(panel).getByRole('status');
    expect(summary).toHaveAttribute('aria-live', 'polite');
    expect(summary).toHaveTextContent('3 errors · 1 warning · 1 suggestion');

    const headings = within(panel)
      .getAllByRole('group')
      .map((group) => group.querySelector('h3').textContent);
    expect(headings).toEqual(['General', 'Facebook', 'Instagram', 'Acme Studio']);

    const general = within(within(panel).getByRole('group', { name: 'General' })).getAllByRole(
      'listitem',
    );
    expect(general).toHaveLength(2);
    expect(general[0]).toHaveTextContent(
      'Warning: 1 selected account is no longer available to you and will be left out.',
    );
    expect(general[1]).toHaveTextContent(/^Suggestion: Add alt text to 1 image/);

    expect(within(panel).getByRole('group', { name: 'Facebook' })).toHaveTextContent(
      'No problems found',
    );

    const instagram = within(panel).getByRole('group', { name: 'Instagram' });
    const instagramIssues = within(instagram).getAllByRole('listitem');
    expect(instagramIssues).toHaveLength(2);
    for (const item of instagramIssues) {
      expect(item).toHaveTextContent(/^Error: photo\.png \(Instagram\)/);
    }
    expect(instagram).toHaveTextContent('2 errors');

    const account = within(panel).getByRole('group', { name: 'Acme Studio' });
    expect(within(account).getByText('@acme.studio · Creator account')).toBeInTheDocument();
    expect(within(account).getByRole('listitem')).toHaveTextContent(
      'Error: Missing permission: instagram_content_publish',
    );
  });

  it('orders issues by severity within a group', () => {
    const issue = (id, severity) => ({
      id,
      severity,
      scope: 'global',
      field: 'caption',
      message: `${id} message`,
    });
    const issues = [
      issue('tip', SEVERITY.INFO),
      issue('bad', SEVERITY.ERROR),
      issue('hmm', SEVERITY.WARNING),
    ];
    const validation = {
      issues,
      errors: [issues[1]],
      warnings: [issues[2]],
      infos: [issues[0]],
      platforms: [],
      selected: [],
    };
    render(<ReadinessPanel validation={validation} />);
    const items = within(screen.getByRole('group', { name: 'General' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Error: bad message',
      'Warning: hmm message',
      'Suggestion: tip message',
    ]);
  });

  it('reports when nothing needs fixing', () => {
    const state = composer({ caption: 'All good', selectedAccountIds: ['acc-fb-1'] });
    const { rerender } = render(<ReadinessPanel validation={validateComposer(state, accounts)} />);

    expect(screen.getByRole('status')).toHaveTextContent('No problems found');
    expect(screen.getByText('Nothing to fix')).toBeInTheDocument();
    expect(
      screen.getByText('Checked against Facebook requirements for the selected account.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    const both = { ...state, selectedAccountIds: ['acc-fb-1', 'acc-fb-2'] };
    rerender(<ReadinessPanel validation={validateComposer(both, accounts)} />);
    expect(
      screen.getByText('Checked against Facebook requirements for the selected accounts.'),
    ).toBeInTheDocument();
  });

  it('says real publishing is not available and never calls anything ready to publish', () => {
    render(<ReadinessPanel validation={validateComposer(composer(), accounts)} />);
    const panel = screen.getByRole('region', { name: 'Readiness check' });

    expect(within(panel).getByRole('status')).toHaveTextContent('2 errors · 0 warnings');
    expect(panel).toHaveTextContent(
      'These checks show what Facebook and Instagram require. Real publishing is not available yet: posts can only be simulated, so nothing is sent to Facebook or Instagram.',
    );
    expect(panel).not.toHaveTextContent(/ready to publish/i);
  });

  it('collapses long groups behind "Show N more"', async () => {
    const user = userEvent.setup();
    const state = composer({
      caption: 'Hi',
      selectedAccountIds: ['acc-ig-1'],
      media: ['p1', 'p2', 'p3'].map(tallPng),
    });
    render(<ReadinessPanel validation={validateComposer(state, accounts)} />);
    const instagram = screen.getByRole('group', { name: 'Instagram' });

    expect(within(instagram).getAllByRole('listitem')).toHaveLength(4);
    const more = within(instagram).getByRole('button', { name: 'Show 2 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    await user.click(more);
    expect(within(instagram).getAllByRole('listitem')).toHaveLength(6);
    expect(within(instagram).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('turns issues into buttons when onIssueSelect is given', async () => {
    const user = userEvent.setup();
    const onIssueSelect = vi.fn();
    render(
      <ReadinessPanel
        validation={validateComposer(composer(), accounts)}
        onIssueSelect={onIssueSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Choose at least one account/ }));
    expect(onIssueSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'accounts-required', field: 'accounts' }),
    );
  });

  it('shows loading and error states without reporting missing accounts', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const state = composer({ caption: 'Hi', selectedAccountIds: ['acc-fb-1'] });
    const premature = validateComposer(state, []);
    const { rerender } = render(<ReadinessPanel validation={premature} status="loading" />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();

    rerender(
      <ReadinessPanel
        validation={premature}
        status="error"
        error={new Error('Network down')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Not checked');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't run the readiness check");
    expect(alert).toHaveTextContent('Network down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
