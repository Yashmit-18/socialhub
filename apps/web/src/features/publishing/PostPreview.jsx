import { platformLabel } from './labels.js';

const PREVIEW_FILES = 4;
const PREVIEW_CAPTION = 280;

const clip = (value) => {
  const chars = [...(value ?? '').trim()];
  return `${chars.slice(0, PREVIEW_CAPTION).join('')}${chars.length > PREVIEW_CAPTION ? '…' : ''}`;
};

/**
 * What will be posted: the files and the caption each platform receives (`captions`:
 * [{ platform, text }], one per platform among the selected accounts). `media` items:
 * { id, kind, previewUrl, posterUrl?, altText?, fileName? }. Used by the composer's Publish
 * dialog and by "Publish a draft".
 */
export function PostPreview({ media, captions }) {
  const distinct = [...new Map(captions.map((c) => [c.text.trim(), c])).values()];
  const hasText = distinct.some((c) => c.text.trim());
  if (media.length === 0 && !hasText) return null;
  return (
    <section aria-label="What will be posted">
      <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
        What will be posted
      </h3>
      {media.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {media.slice(0, PREVIEW_FILES).map((item) => {
            const still = item.kind === 'VIDEO' ? item.posterUrl : item.previewUrl;
            return (
              <li
                key={item.id}
                className="h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5"
              >
                {still ? (
                  <img
                    src={still}
                    alt={item.altText || item.fileName || 'Attached file'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center px-1 text-center text-xs text-muted">
                    {item.kind === 'VIDEO' ? 'Video' : 'Image'}
                  </span>
                )}
              </li>
            );
          })}
          {media.length > PREVIEW_FILES && (
            <li className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-muted dark:border-white/15">
              +{media.length - PREVIEW_FILES}
            </li>
          )}
        </ul>
      )}
      {!hasText ? (
        <p className="text-sm text-muted">No caption.</p>
      ) : (
        distinct.map((c) => (
          <div key={c.platform} className="mt-1">
            {distinct.length > 1 && (
              <p className="text-xs font-medium text-muted">{platformLabel(c.platform)}</p>
            )}
            <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">
              {c.text.trim() ? clip(c.text) : <span className="text-muted">No caption.</span>}
            </p>
          </div>
        ))
      )}
    </section>
  );
}
