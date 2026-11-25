import { Button } from './Button.jsx';
import { FormError } from './Field.jsx';
import { Modal } from './Modal.jsx';

/**
 * Destructive-action confirmation with loading and error states. `confirmDisabled` keeps the
 * confirm button off until the dialog's own condition is met (for example a ticked checkbox).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  loading,
  error,
  confirmDisabled = false,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={confirmDisabled}
            onClick={confirmDisabled ? undefined : onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <FormError message={error.message} />
      ) : (
        (children ?? <p className="text-sm text-muted">This takes effect immediately.</p>)
      )}
    </Modal>
  );
}
