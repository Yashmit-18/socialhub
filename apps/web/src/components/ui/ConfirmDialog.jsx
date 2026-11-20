import { Button } from './Button.jsx';
import { FormError } from './Field.jsx';
import { Modal } from './Modal.jsx';

/** Destructive-action confirmation with loading and error states. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  loading,
  error,
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
          <Button variant="danger" loading={loading} onClick={onConfirm}>
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
