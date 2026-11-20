import { LogOut } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '../../../../components/ui/Button.jsx';
import { Modal } from '../../../../components/ui/Modal.jsx';

export const DEFAULT_UNSAVED_DESCRIPTION = "Some of your changes haven't been saved.";

/**
 * "Leave this page?" confirmation for a navigation held by useUnsavedChangesGuard().
 * Open while `blocker.state === 'blocked'`. Stay (also Escape, the backdrop and the close
 * button) → blocker.reset(); Leave → blocker.proceed(). "Stay" receives focus first.
 */
export function UnsavedChangesDialog({
  blocker,
  description = DEFAULT_UNSAVED_DESCRIPTION,
  title = 'Leave this page?',
  children,
}) {
  const open = blocker?.state === 'blocked';
  const stay = useCallback(() => blocker?.reset?.(), [blocker]);
  const leave = useCallback(() => blocker?.proceed?.(), [blocker]);

  return (
    <Modal
      open={open}
      onClose={stay}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={stay}>
            Stay
          </Button>
          <Button variant="danger" onClick={leave}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Leave
          </Button>
        </>
      }
    >
      {children ?? (
        <p className="text-sm text-muted">Stay on this page to keep working on your post.</p>
      )}
    </Modal>
  );
}
