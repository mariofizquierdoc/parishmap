import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode } from '../api';

/**
 * Asks the admin to type a record's name before deleting it, so a slip of the mouse can't
 * delete anything. Closing the dialog leaves everything as it was.
 */
export function ConfirmDeleteDialog({
  title,
  name,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  /** What the admin must type. */
  name: string;
  /** Explains what will be lost. */
  children?: ReactNode;
  /** Should throw if the delete fails; the dialog then shows the error and stays open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const matches = typed.trim() === name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(t(`admin.errors.${errorCode(caught)}`, t('admin.errors.generic')));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="confirm-title">{title}</h2>
        {children}
        <label className="admin-field">
          <span>{t('admin.confirmDelete.typeName', { name })}</span>
          <input
            value={typed}
            autoComplete="off"
            autoFocus
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        {error && (
          <p className="message message-error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="button button-danger" disabled={!matches || busy}>
            {t('admin.confirmDelete.confirm')}
          </button>
          <button type="button" className="button" onClick={() => dialog.current?.close()}>
            {t('admin.confirmDelete.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
