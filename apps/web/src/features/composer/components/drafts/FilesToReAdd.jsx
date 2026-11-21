import { FileImage, FileVideo, ImagePlus, X } from 'lucide-react';
import { cn } from '../../../../lib/utils.js';
import { MEDIA_KINDS } from '../../model/composerState.js';

/**
 * Shown after a device draft is restored: browser drafts can't keep file contents, so this
 * lists the files the draft had until each one is added again (or the note is dismissed).
 * Alt text saved with the draft is applied automatically when a file with the same name is
 * added again.
 *
 * Props: files [{ fileName, kind, altText }], onDismiss()
 */
export function FilesToReAdd({ files = [], onDismiss, className }) {
  if (files.length === 0) return null;
  const withAltText = files.filter((file) => file.altText).length;
  return (
    <section
      aria-label="Files to add again"
      className={cn(
        'rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <ImagePlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {files.length === 1 ? 'Add 1 file again' : `Add ${files.length} files again`}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed opacity-90">
            Drafts saved in this browser keep the text, not the files.
            {withAltText > 0 &&
              ' Saved alt text is filled in when you add a file with the same name.'}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {files.map((file, index) => {
              const Icon = file.kind === MEDIA_KINDS.VIDEO ? FileVideo : FileImage;
              return (
                <li
                  key={`${file.fileName}:${index}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-xs font-medium ring-1 ring-amber-200/80 ring-inset dark:bg-white/5 dark:ring-amber-400/20"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="truncate">{file.fileName}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss the list of files to add again"
            className="-mr-1 -mt-0.5 shrink-0 rounded-lg p-1.5 opacity-70 transition hover:bg-amber-100 hover:opacity-100 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
