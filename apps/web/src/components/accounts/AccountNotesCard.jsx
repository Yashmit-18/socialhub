/**
 * Team notes on one account (contacts, posting guidelines, anything the team should know).
 * Everyone who can see the account reads them; members who manage logins edit them. Notes
 * stay in SocialHub and are never sent to Meta.
 */
import { ACCOUNT_LABEL_LIMITS } from '@socialhub/shared';
import { Pencil, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../ui/Card.jsx';
import { FormError } from '../ui/Field.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useSaveNotes } from '../../hooks/useAccountActions.js';
import { formatDate, timeAgo } from '../../lib/utils.js';

export function AccountNotesCard({ accountId, notes, canEdit }) {
  const { workspace } = useWorkspace();
  const save = useSaveNotes(workspace.id, accountId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const text = notes?.text ?? '';
  const max = ACCOUNT_LABEL_LIMITS.NOTES_MAX;

  const startEditing = () => {
    setDraft(text);
    save.reset();
    setEditing(true);
  };

  const submit = (e) => {
    e.preventDefault();
    save.mutate(draft, {
      onSuccess: ({ notes: saved }) => {
        toast.success(saved.text ? 'Notes saved' : 'Notes cleared');
        setEditing(false);
      },
    });
  };

  return (
    <Card>
      <CardHeader
        icon={StickyNote}
        title="Team notes"
        description="Contacts, posting guidelines or anything else the team should know about this account. Kept in SocialHub only."
        action={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {text ? 'Edit' : 'Add notes'}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {editing ? (
          <form onSubmit={submit} className="space-y-3">
            <label htmlFor={`notes-${accountId}`} className="sr-only">
              Team notes
            </label>
            <textarea
              id={`notes-${accountId}`}
              value={draft}
              maxLength={max}
              rows={6}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="For example: client contact, approval rules, best posting times"
              className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted tabular-nums">
                {draft.length.toLocaleString()} / {max.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={save.isPending}>
                  Save notes
                </Button>
              </div>
            </div>
            <FormError message={save.error?.fields?.notes ?? save.error?.message} />
          </form>
        ) : text ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              {text}
            </p>
            {notes?.updatedAt && (
              <p className="text-xs text-muted">
                Last edited{notes.updatedBy?.name ? ` by ${notes.updatedBy.name}` : ''}{' '}
                <time
                  dateTime={notes.updatedAt}
                  title={formatDate(notes.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                >
                  {timeAgo(notes.updatedAt)}
                </time>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {canEdit
              ? 'No notes yet. Add the details your team needs when working with this account.'
              : 'No notes yet.'}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
