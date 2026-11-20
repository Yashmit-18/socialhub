import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ALT_TEXT_MAX,
  INSPECTION_STATUS,
  MEDIA_KINDS,
  MEDIA_MAX_ITEMS,
  UPLOAD_STATUS,
  composerActions,
  createMediaItem,
} from '../../model/composerState.js';
import { ACCEPTED_TYPES, ACCEPT_ATTRIBUTE, formatLabel } from '../../model/media.js';
import { CAPABILITY_MESSAGES } from '../../services/capabilities.js';
import { ComposerHarness } from '../../test/ComposerHarness.jsx';
import { dataTransferWith, makeFile } from '../../test/browserMocks.js';
import { MediaDropzone, UPLOAD_NOTE } from './MediaDropzone.jsx';
import { MediaGrid } from './MediaGrid.jsx';
import { MediaPreviewDialog } from './MediaPreviewDialog.jsx';

/* ---------------------------------------------------------------- fixtures */

const image = (id, overrides = {}) => ({
  ...createMediaItem({
    id,
    kind: MEDIA_KINDS.IMAGE,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1_250_000,
    previewUrl: `blob:mock/${id}`,
  }),
  inspection: INSPECTION_STATUS.DONE,
  width: 1080,
  height: 1350,
  ...overrides,
});

const video = (id, overrides = {}) => ({
  ...createMediaItem({
    id,
    kind: MEDIA_KINDS.VIDEO,
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    sizeBytes: 48_000_000,
    previewUrl: `blob:mock/${id}`,
  }),
  inspection: INSPECTION_STATUS.DONE,
  width: 1080,
  height: 1920,
  durationSec: 42,
  ...overrides,
});

const upload = (status, extra = {}) => ({
  status,
  progress: 0,
  mediaId: null,
  error: null,
  ...extra,
});

const tileOf = (fileName) =>
  screen.getByRole('button', { name: `Preview ${fileName}` }).closest('li');

/** Renders MediaGrid on the real reducer; spies record what the grid asked for. */
function renderGrid({ media, uploadAvailable = false } = {}) {
  const spies = {
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onAltTextChange: vi.fn(),
    onPreview: vi.fn(),
    onRetryUpload: vi.fn(),
    onCancelUpload: vi.fn(),
  };
  let latest;
  const utils = render(
    <ComposerHarness initial={{ media }} onState={(s) => (latest = s)}>
      {({ state, dispatch }) => (
        <MediaGrid
          media={state.media}
          uploadAvailable={uploadAvailable}
          onRemove={(id) => {
            spies.onRemove(id);
            dispatch(composerActions.removeMedia(id));
          }}
          onMove={(id, to) => {
            spies.onMove(id, to);
            dispatch(composerActions.moveMedia(id, to));
          }}
          onAltTextChange={(id, text) => {
            spies.onAltTextChange(id, text);
            dispatch(composerActions.setMediaAltText(id, text));
          }}
          onPreview={spies.onPreview}
          onRetryUpload={spies.onRetryUpload}
          onCancelUpload={spies.onCancelUpload}
        />
      )}
    </ComposerHarness>,
  );
  return { ...utils, spies, state: () => latest };
}

const order = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('data-media-id'));

/* ------------------------------------------------------------------ dropzone */

describe('MediaDropzone', () => {
  const zone = (name = 'Drag photos and videos here') => screen.getByRole('group', { name });

  it('describes what it accepts (from the accepted types) and how many files are attached', () => {
    render(<MediaDropzone onFiles={vi.fn()} count={3} max={MEDIA_MAX_ITEMS} />);
    const formats = [MEDIA_KINDS.IMAGE, MEDIA_KINDS.VIDEO]
      .map((kind) => ACCEPTED_TYPES[kind].map(formatLabel).join(', '))
      .join(' · ');

    expect(formats).toMatch(/^JPEG, PNG.* · MP4/);
    expect(zone()).toHaveAccessibleDescription(`${formats} 3 of ${MEDIA_MAX_ITEMS} files`);
    expect(screen.getByText(`3 of ${MEDIA_MAX_ITEMS} files`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse files' })).toBeEnabled();
  });

  it('highlights while files are dragged over it and hands dropped files to onFiles', () => {
    const onFiles = vi.fn();
    render(<MediaDropzone onFiles={onFiles} />);
    const photo = makeFile('beach.jpg', 'image/jpeg');
    const target = zone();

    fireEvent.dragEnter(target, { dataTransfer: dataTransferWith([photo]) });
    expect(target).toHaveAttribute('data-dragging', 'true');
    expect(screen.getByRole('group', { name: 'Drop to add' })).toBe(target);
    // dragover must be cancelled for the browser to allow the drop.
    expect(fireEvent.dragOver(target, { dataTransfer: dataTransferWith([photo]) })).toBe(false);

    fireEvent.drop(target, { dataTransfer: dataTransferWith([photo]) });

    expect(onFiles).toHaveBeenCalledWith([photo]);
    expect(target).not.toHaveAttribute('data-dragging');
  });

  it('does not flicker when the drag moves over its children', () => {
    render(<MediaDropzone onFiles={vi.fn()} />);
    const target = zone();
    const child = screen.getByText('Drag photos and videos here');
    const transfer = dataTransferWith([makeFile('a.png', 'image/png')]);

    fireEvent.dragEnter(target, { dataTransfer: transfer });
    fireEvent.dragEnter(child, { dataTransfer: transfer });
    fireEvent.dragLeave(target, { dataTransfer: transfer });
    expect(target).toHaveAttribute('data-dragging', 'true');

    fireEvent.dragLeave(child, { dataTransfer: transfer });
    expect(target).not.toHaveAttribute('data-dragging');
  });

  it('ignores drags that carry no files (text, links, media tiles)', () => {
    const onFiles = vi.fn();
    render(<MediaDropzone onFiles={onFiles} />);
    const target = zone();
    const text = { types: ['text/plain'], files: [], items: [], dropEffect: 'none' };

    fireEvent.dragEnter(target, { dataTransfer: text });
    expect(target).not.toHaveAttribute('data-dragging');
    expect(fireEvent.dragOver(target, { dataTransfer: text })).toBe(true);
    fireEvent.drop(target, { dataTransfer: text });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('opens the file picker from "Browse files" and resets it after a pick', async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    render(<MediaDropzone onFiles={onFiles} />);
    const input = screen.getByLabelText('Choose photos and videos to add');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', ACCEPT_ATTRIBUTE);
    expect(input).toHaveProperty('multiple', true);

    await user.click(screen.getByRole('button', { name: 'Browse files' }));
    expect(click).toHaveBeenCalled();

    const photo = makeFile('beach.jpg', 'image/jpeg');
    const clip = makeFile('waves.mp4', 'video/mp4');
    await user.upload(input, [photo, clip]);

    expect(onFiles).toHaveBeenCalledWith([photo, clip]);
    expect(input.value).toBe('');
  });

  it('adds pasted images while focus is inside the zone', () => {
    const onFiles = vi.fn();
    render(<MediaDropzone onFiles={onFiles} />);
    const screenshot = makeFile('image.png', 'image/png');

    expect(fireEvent.paste(zone(), { clipboardData: dataTransferWith([screenshot]) })).toBe(false);
    expect(onFiles).toHaveBeenCalledWith([screenshot]);

    // Plain text paste is left alone.
    const text = { types: ['text/plain'], files: [], items: [] };
    expect(fireEvent.paste(zone(), { clipboardData: text })).toBe(true);
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('turns itself off at the file limit', async () => {
    const onFiles = vi.fn();
    render(<MediaDropzone onFiles={onFiles} count={MEDIA_MAX_ITEMS} max={MEDIA_MAX_ITEMS} />);
    const target = screen.getByRole('group', { name: `You've added ${MEDIA_MAX_ITEMS} files` });
    const transfer = dataTransferWith([makeFile('one-more.jpg', 'image/jpeg')]);

    expect(screen.getByRole('button', { name: 'Browse files' })).toBeDisabled();
    expect(screen.getByLabelText('Choose photos and videos to add')).toBeDisabled();
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('none');
    fireEvent.drop(target, { dataTransfer: transfer });
    fireEvent.paste(target, { clipboardData: dataTransferWith([makeFile('x.png', 'image/png')]) });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove a file to add a different one/)).toBeInTheDocument();
  });

  it('is disabled on request', () => {
    const onFiles = vi.fn();
    render(<MediaDropzone onFiles={onFiles} disabled />);

    expect(screen.getByRole('button', { name: 'Browse files' })).toBeDisabled();
    fireEvent.drop(zone(), { dataTransfer: dataTransferWith([makeFile('a.jpg', 'image/jpeg')]) });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('says honestly where files go: this browser only, or SocialHub once uploads exist', () => {
    const { rerender } = render(<MediaDropzone onFiles={vi.fn()} uploadAvailable={false} />);
    expect(screen.getByText(CAPABILITY_MESSAGES.mediaUpload)).toBeInTheDocument();
    expect(screen.queryByText(UPLOAD_NOTE)).toBeNull();

    rerender(<MediaDropzone onFiles={vi.fn()} uploadAvailable />);
    expect(screen.queryByText(CAPABILITY_MESSAGES.mediaUpload)).toBeNull();
    expect(screen.getByText(UPLOAD_NOTE)).toHaveTextContent(/Nothing is posted/);
  });

  it('has a slim "Add more" layout for when media is attached', () => {
    const onFiles = vi.fn();
    render(<MediaDropzone onFiles={onFiles} compact count={4} />);
    const target = screen.getByRole('group', { name: 'Add more' });

    expect(within(target).getByText(`4 of ${MEDIA_MAX_ITEMS} files`)).toBeInTheDocument();
    fireEvent.drop(target, { dataTransfer: dataTransferWith([makeFile('b.gif', 'image/gif')]) });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('lists files that were not added, with dismiss controls', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onClear = vi.fn();
    const rejections = [
      { id: 'r1', fileName: 'notes.pdf', reason: "notes.pdf isn't a supported file." },
      { id: 'r2', fileName: 'IMG_1.heic', reason: 'IMG_1.heic is a HEIC photo.' },
    ];
    render(
      <MediaDropzone
        onFiles={vi.fn()}
        rejections={rejections}
        onDismissRejection={onDismiss}
        onClearRejections={onClear}
      />,
    );

    expect(screen.getByText("notes.pdf isn't a supported file.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss message about notes.pdf' }));
    expect(onDismiss).toHaveBeenCalledWith('r1');
    await user.click(screen.getByRole('button', { name: 'Dismiss all' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('keeps an (empty) live region for messages so new ones are announced', () => {
    const { container } = render(<MediaDropzone onFiles={vi.fn()} rejections={[]} />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
  });

  it('stops the browser from opening files dropped beside the zone', () => {
    const fileDrop = () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: dataTransferWith([makeFile('a.jpg', 'image/jpeg')]),
      });
      return event;
    };
    const textDrop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(textDrop, 'dataTransfer', { value: { types: ['text/plain'] } });
    const { unmount } = render(<MediaDropzone onFiles={vi.fn()} />);

    const outside = fileDrop();
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    document.body.dispatchEvent(textDrop);
    expect(textDrop.defaultPrevented).toBe(false);

    unmount();
    const afterUnmount = fileDrop();
    document.body.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });
});

/* ---------------------------------------------------------------------- grid */

describe('MediaGrid', () => {
  it('shows each file with its details, the first one marked as the cover', () => {
    renderGrid({
      media: [
        image('a'),
        video('b'),
        image('c', { inspection: INSPECTION_STATUS.PENDING, width: null, height: null }),
        image('d', { inspection: INSPECTION_STATUS.FAILED, width: null, height: null }),
      ],
    });

    expect(screen.getByRole('list', { name: 'Attached media' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(within(tileOf('a.jpg')).getByText('Cover')).toBeInTheDocument();
    expect(within(tileOf('b.mp4')).queryByText('Cover')).toBeNull();

    const a = within(tileOf('a.jpg'));
    expect(a.getByText('1.3 MB')).toBeInTheDocument();
    expect(a.getByText('1080×1350')).toBeInTheDocument();
    expect(a.getByText('4:5')).toBeInTheDocument();

    const b = within(tileOf('b.mp4'));
    expect(b.getByText('48 MB')).toBeInTheDocument();
    expect(b.getByText('9:16')).toBeInTheDocument();
    expect(b.getAllByText('0:42').length).toBeGreaterThan(0);

    expect(within(tileOf('c.jpg')).getByText('Reading file…')).toBeInTheDocument();
    expect(within(tileOf('d.jpg')).getByText("Couldn't read details")).toBeInTheDocument();
  });

  it('previews videos from their first frame, muted, without loading the whole file', () => {
    renderGrid({ media: [video('clip')] });
    const element = tileOf('clip.mp4').querySelector('video');

    expect(element).toHaveAttribute('src', 'blob:mock/clip#t=0.1');
    expect(element).toHaveAttribute('preload', 'metadata');
    expect(element).toHaveAttribute('playsinline');
    expect(element.muted).toBe(true);
    expect(element).not.toHaveAttribute('controls');
  });

  it('falls back to a placeholder when there is no preview or it fails to load', () => {
    renderGrid({ media: [image('a', { previewUrl: null }), image('b')] });

    expect(within(tileOf('a.jpg')).getByText('No preview')).toBeInTheDocument();
    const img = tileOf('b.jpg').querySelector('img');
    fireEvent.error(img);
    expect(within(tileOf('b.jpg')).getByText('No preview')).toBeInTheDocument();
  });

  it('opens the preview from the thumbnail', async () => {
    const user = userEvent.setup();
    const { spies } = renderGrid({ media: [image('a'), image('b')] });

    await user.click(screen.getByRole('button', { name: 'Preview b.jpg' }));

    expect(spies.onPreview).toHaveBeenCalledWith('b');
  });

  it('reorders with the move buttons, announces it, and keeps focus on an enabled control', async () => {
    const user = userEvent.setup();
    const { spies } = renderGrid({ media: [image('a'), image('b'), image('c')] });
    expect(screen.getByRole('button', { name: 'Move a.jpg earlier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move c.jpg later' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move b.jpg later' }));

    expect(spies.onMove).toHaveBeenCalledWith('b', 2);
    expect(order()).toEqual(['a', 'c', 'b']);
    expect(screen.getByRole('status')).toHaveTextContent('Moved b.jpg to position 3 of 3');
    // "Move later" is now disabled, so focus moved to its sibling.
    expect(screen.getByRole('button', { name: 'Move b.jpg later' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move b.jpg earlier' })).toHaveFocus();

    // Keyboard only: Enter on the focused control moves it again.
    await user.keyboard('{Enter}');
    expect(order()).toEqual(['a', 'b', 'c']);
    expect(screen.getByRole('status')).toHaveTextContent('Moved b.jpg to position 2 of 3');
    expect(screen.getByRole('button', { name: 'Move b.jpg earlier' })).toHaveFocus();
    expect(within(tileOf('a.jpg')).getByText('Cover')).toBeInTheDocument();
  });

  it('makes a moved file the cover when it reaches the front', async () => {
    const user = userEvent.setup();
    renderGrid({ media: [image('a'), image('b')] });

    await user.click(screen.getByRole('button', { name: 'Move b.jpg earlier' }));

    expect(order()).toEqual(['b', 'a']);
    expect(within(tileOf('b.jpg')).getByText('Cover')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move b.jpg later' })).toHaveFocus();
  });

  it('reorders by dragging one tile onto another, with a visible drop marker', () => {
    const { spies } = renderGrid({ media: [image('a'), image('b'), image('c')] });
    const transfer = { setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none', types: [] };
    const [a, b, c] = screen.getAllByRole('listitem');
    expect(a).toHaveAttribute('draggable', 'true');

    fireEvent.dragStart(a, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith('application/x-socialhub-media', 'a');
    expect(transfer.effectAllowed).toBe('move');

    expect(fireEvent.dragOver(c, { dataTransfer: transfer })).toBe(false);
    expect(c).toHaveAttribute('data-drop-position', 'after');
    expect(transfer.dropEffect).toBe('move');
    fireEvent.dragOver(b, { dataTransfer: transfer });
    expect(b).toHaveAttribute('data-drop-position', 'after');
    expect(c).not.toHaveAttribute('data-drop-position');

    fireEvent.drop(c, { dataTransfer: transfer });

    expect(spies.onMove).toHaveBeenCalledWith('a', 2);
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(screen.getByRole('status')).toHaveTextContent('Moved a.jpg to position 3 of 3');
    expect(document.querySelector('[data-drop-position]')).toBeNull();
  });

  it('marks the drop before the target when dragging towards the front', () => {
    renderGrid({ media: [image('a'), image('b'), image('c')] });
    const transfer = { setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none', types: [] };
    const [a, , c] = screen.getAllByRole('listitem');

    fireEvent.dragStart(c, { dataTransfer: transfer });
    fireEvent.dragOver(a, { dataTransfer: transfer });
    expect(a).toHaveAttribute('data-drop-position', 'before');

    fireEvent.dragEnd(c, { dataTransfer: transfer });
    expect(a).not.toHaveAttribute('data-drop-position');
    expect(order()).toEqual(['a', 'b', 'c']);
  });

  it('leaves file drags over tiles alone', () => {
    const { spies } = renderGrid({ media: [image('a'), image('b')] });
    const [a] = screen.getAllByRole('listitem');
    const files = dataTransferWith([makeFile('x.jpg', 'image/jpeg')]);

    expect(fireEvent.dragOver(a, { dataTransfer: files })).toBe(true);
    fireEvent.drop(a, { dataTransfer: files });
    expect(spies.onMove).not.toHaveBeenCalled();
    expect(a).not.toHaveAttribute('data-drop-position');
  });

  it('keeps text dragged out of the alt text field a text drag', async () => {
    const user = userEvent.setup();
    renderGrid({ media: [image('a'), image('b')] });
    await user.click(screen.getByRole('button', { name: 'Add alt text for a.jpg' }));
    const field = screen.getByRole('textbox', { name: 'Alt text for a.jpg' });
    const [a, b] = screen.getAllByRole('listitem');
    const transfer = { setData: vi.fn(), effectAllowed: 'all', dropEffect: 'none', types: [] };
    // While the editor is open the tile itself isn't draggable.
    expect(a).not.toHaveAttribute('draggable');

    fireEvent.dragStart(field, { dataTransfer: transfer });

    expect(transfer.setData).not.toHaveBeenCalled();
    expect(fireEvent.dragOver(b, { dataTransfer: transfer })).toBe(true);
    expect(b).not.toHaveAttribute('data-drop-position');
  });

  it('renders only the controls it has handlers for', () => {
    render(<MediaGrid media={[video('a'), image('b')]} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getAllByText('In this browser')).toHaveLength(2);
  });

  it('has no reorder controls for a single file', () => {
    renderGrid({ media: [image('only')] });

    expect(screen.queryByRole('button', { name: /Move only\.jpg/ })).toBeNull();
    expect(screen.getByRole('listitem')).not.toHaveAttribute('draggable');
    expect(screen.queryByText(/Drag files to reorder/)).toBeNull();
  });

  it('removes a file, announces it and moves focus to the next file', async () => {
    const user = userEvent.setup();
    const { spies } = renderGrid({ media: [image('a'), image('b'), image('c')] });

    await user.click(screen.getByRole('button', { name: 'Remove a.jpg' }));

    expect(spies.onRemove).toHaveBeenCalledWith('a');
    expect(order()).toEqual(['b', 'c']);
    expect(screen.getByRole('status')).toHaveTextContent('Removed a.jpg');
    expect(screen.getByRole('button', { name: 'Preview b.jpg' })).toHaveFocus();
    expect(within(tileOf('b.jpg')).getByText('Cover')).toBeInTheDocument();
  });

  it('moves focus to the previous file when the last one is removed', async () => {
    const user = userEvent.setup();
    renderGrid({ media: [image('a'), image('b')] });

    await user.click(screen.getByRole('button', { name: 'Remove b.jpg' }));

    expect(screen.getByRole('button', { name: 'Preview a.jpg' })).toHaveFocus();
  });

  it('edits alt text for images (only), with a length limit and a counter', async () => {
    const user = userEvent.setup();
    const { spies, state } = renderGrid({ media: [image('a'), video('b')] });
    expect(screen.queryByRole('button', { name: /alt text for b\.mp4/ })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Add alt text for a.jpg' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const field = screen.getByRole('textbox', { name: 'Alt text for a.jpg' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('maxLength', String(ALT_TEXT_MAX));
    expect(toggle).toHaveAttribute('aria-controls', field.id);

    await user.type(field, 'A red bicycle');

    expect(spies.onAltTextChange).toHaveBeenLastCalledWith('a', 'A red bicycle');
    expect(state().media[0].altText).toBe('A red bicycle');
    expect(screen.getByText('13 of 1,000 characters')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/screen readers.*13 of 1,000 characters/);

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('textbox', { name: 'Alt text for a.jpg' })).toBeNull();
    const edit = screen.getByRole('button', { name: 'Edit alt text for a.jpg' });
    expect(edit).toHaveFocus();

    await user.click(edit);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Alt text for a.jpg' })).toBeNull();
    expect(edit).toHaveFocus();
  });

  it('labels every upload status honestly', async () => {
    const user = userEvent.setup();
    const { spies } = renderGrid({
      uploadAvailable: true,
      media: [
        image('local'),
        image('sending', { upload: upload(UPLOAD_STATUS.UPLOADING, { progress: 0.42 }) }),
        image('working', { upload: upload(UPLOAD_STATUS.PROCESSING, { progress: 1 }) }),
        image('stored', { upload: upload(UPLOAD_STATUS.UPLOADED, { progress: 1, mediaId: 'm9' }) }),
        image('broken', {
          upload: upload(UPLOAD_STATUS.FAILED, { error: 'Storage rejected the file.' }),
        }),
      ],
    });

    const local = within(tileOf('local.jpg'));
    expect(local.getByText('In this browser')).toBeInTheDocument();
    expect(local.queryByText('Uploaded')).toBeNull();
    await user.click(local.getByRole('button', { name: 'Upload local.jpg' }));
    expect(spies.onRetryUpload).toHaveBeenCalledWith('local');

    const sending = within(tileOf('sending.jpg'));
    const bar = sending.getByRole('progressbar', { name: 'Uploading sending.jpg' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(sending.getByText('42%')).toBeInTheDocument();
    await user.click(sending.getByRole('button', { name: 'Cancel upload of sending.jpg' }));
    expect(spies.onCancelUpload).toHaveBeenCalledWith('sending');

    expect(within(tileOf('working.jpg')).getByText('Processing')).toBeInTheDocument();
    expect(within(tileOf('stored.jpg')).getByText('Uploaded')).toBeInTheDocument();

    const broken = within(tileOf('broken.jpg'));
    expect(broken.getByText('Upload failed')).toBeInTheDocument();
    expect(broken.getByText('Storage rejected the file.')).toBeInTheDocument();
    await user.click(broken.getByRole('button', { name: 'Retry upload of broken.jpg' }));
    expect(spies.onRetryUpload).toHaveBeenCalledWith('broken');
  });

  it('never offers uploads, or claims a file was uploaded, while the media API is off', () => {
    renderGrid({ media: [image('a'), video('b')], uploadAvailable: false });

    const chips = screen.getAllByText('In this browser');
    expect(chips).toHaveLength(2);
    expect(chips[0].closest('[title]')).toHaveAttribute('title', CAPABILITY_MESSAGES.mediaUpload);
    expect(within(tileOf('a.jpg')).getByText('(not uploaded)')).toHaveClass('sr-only');
    expect(screen.queryByText('Uploaded')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Upload / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Retry upload/ })).toBeNull();
  });
});

/* -------------------------------------------------------------------- dialog */

function DialogHarness({ media, initialIndex = 0, onClose }) {
  const [index, setIndex] = useState(initialIndex);
  return (
    <MediaPreviewDialog
      media={media}
      index={index}
      onNavigate={setIndex}
      onClose={() => {
        onClose?.();
        setIndex(null);
      }}
    />
  );
}

describe('MediaPreviewDialog', () => {
  const media = [
    image('a', { altText: 'A red bicycle against a wall' }),
    video('b'),
    image('c', { inspection: INSPECTION_STATUS.FAILED, width: null, height: null }),
  ];

  it('shows the file large with its position and details', () => {
    render(<DialogHarness media={media} />);
    const dialog = screen.getByRole('dialog', { name: 'a.jpg' });

    expect(dialog).toHaveAccessibleDescription('1 of 3');
    expect(
      within(dialog).getByRole('img', { name: 'A red bicycle against a wall' }),
    ).toHaveAttribute('src', 'blob:mock/a');
    expect(within(dialog).getByText('JPEG image')).toBeInTheDocument();
    expect(within(dialog).getByText('1.3 MB')).toBeInTheDocument();
    expect(within(dialog).getByText('1080 × 1350 px')).toBeInTheDocument();
    expect(within(dialog).getByText('4:5')).toBeInTheDocument();
    expect(within(dialog).getByText('In this browser (not uploaded)')).toBeInTheDocument();
  });

  it('plays videos with native controls', () => {
    render(<DialogHarness media={media} initialIndex={1} />);
    const dialog = screen.getByRole('dialog', { name: 'b.mp4' });
    const player = dialog.querySelector('video');

    expect(player).toHaveAttribute('src', 'blob:mock/b');
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('playsinline');
    expect(within(dialog).getByText('0:42')).toBeInTheDocument();
  });

  it('moves between files with the buttons and the arrow keys', async () => {
    const user = userEvent.setup();
    render(<DialogHarness media={media} />);
    expect(screen.getByRole('button', { name: 'Previous file' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next file' }));
    expect(screen.getByRole('dialog', { name: 'b.mp4' })).toHaveAccessibleDescription('2 of 3');

    await user.keyboard('{ArrowRight}');
    const last = screen.getByRole('dialog', { name: 'c.jpg' });
    expect(last).toHaveAccessibleDescription('3 of 3');
    expect(within(last).getAllByText("Couldn't read").length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'c.jpg' })).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'b.mp4' })).toBeInTheDocument();
  });

  it('hands focus to the other button when the one used becomes disabled', async () => {
    const user = userEvent.setup();
    render(<DialogHarness media={media} initialIndex={1} />);

    await user.click(screen.getByRole('button', { name: 'Next file' }));

    expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous file' })).toHaveFocus();
  });

  it('leaves arrow keys to a focused video player', () => {
    render(<DialogHarness media={media} initialIndex={1} />);
    const player = screen.getByRole('dialog').querySelector('video');

    fireEvent.keyDown(player, { key: 'ArrowRight' });

    expect(screen.getByRole('dialog', { name: 'b.mp4' })).toBeInTheDocument();
  });

  it('closes with the close button and with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<DialogHarness media={media} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    render(<DialogHarness media={media} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays closed without a valid index', () => {
    const { rerender } = render(
      <MediaPreviewDialog media={media} index={null} onClose={vi.fn()} onNavigate={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<MediaPreviewDialog media={media} index={7} onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps focus where it is when the parent re-renders with new callbacks', () => {
    const { rerender } = render(
      <MediaPreviewDialog media={media} index={1} onClose={() => {}} onNavigate={() => {}} />,
    );
    const next = screen.getByRole('button', { name: 'Next file' });
    next.focus();

    rerender(
      <MediaPreviewDialog media={media} index={1} onClose={() => {}} onNavigate={() => {}} />,
    );

    expect(next).toHaveFocus();
  });

  it('explains when a file cannot be previewed', () => {
    render(<DialogHarness media={[image('a', { previewUrl: null })]} />);

    expect(screen.getByText("Preview isn't available")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next file' })).toBeNull();
  });
});
