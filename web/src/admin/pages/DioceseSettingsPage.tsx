import type { AdminDiocese, AdminVicariate } from '@parishmap/shared/admin';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { adminRequest, errorCode } from '../api';
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog';

/** The importer matches vicariates by name, so renaming one of these breaks the next import. */
const IMPORTED_DIOCESES = ['guayaquil'];

type Message = { ok: boolean; text: string } | null;

export function DioceseSettingsPage() {
  const { t } = useTranslation();
  const { dioceseSlug = '' } = useParams();
  const { state, retry } = useLoad(`settings/${dioceseSlug}`, (signal) =>
    adminRequest<AdminDiocese>(`/dioceses/${encodeURIComponent(dioceseSlug)}`, { signal }),
  );

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>;
  }
  return <SettingsView key={state.data.id} diocese={state.data} />;
}

function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown) => t(`admin.errors.${errorCode(error)}`, t('admin.errors.generic'));
}

function SettingsView({ diocese }: { diocese: AdminDiocese }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [savedName, setSavedName] = useState(diocese.name);
  const [form, setForm] = useState({
    name: diocese.name,
    sourceUrl: diocese.sourceUrl ?? '',
    isPublished: diocese.isPublished,
  });
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await adminRequest(`/dioceses/${diocese.id}`, { method: 'PATCH', body: form });
      setSavedName(form.name);
      setMessage({ ok: true, text: t('admin.dioceseSettings.saved') });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const parishCount = diocese.parishes.length;

  return (
    <main className="admin-main">
      <Link to={`/admin/${diocese.slug}`}>← {t('admin.dioceseSettings.back')}</Link>
      <h1>{t('admin.dioceseSettings.title', { name: savedName })}</h1>

      <section className="admin-card">
        <h2>{t('admin.dioceseSettings.details')}</h2>
        <form className="parish-form" onSubmit={(event) => void save(event)}>
          <label className="admin-field">
            <span>{t('admin.dioceses.name')}</span>
            <input
              value={form.name}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <p className="source-name">
            {t('admin.dioceses.slug')}: <code>/{diocese.slug}</code> ·{' '}
            {t('admin.dioceseSettings.slugLocked')}
          </p>
          <label className="admin-field">
            <span>{t('admin.dioceses.sourceUrl')}</span>
            <input
              type="url"
              value={form.sourceUrl}
              onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })}
            />
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
            />
            <span>
              {t('admin.dioceses.isPublished')}
              <small>{t('admin.dioceses.isPublishedHelp')}</small>
            </span>
          </label>
          {message && (
            <p
              className={`message ${message.ok ? 'message-success' : 'message-error'}`}
              role="status"
            >
              {message.text}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={busy}>
            {t('admin.dioceseSettings.save')}
          </button>
        </form>
      </section>

      <Vicariates diocese={diocese} />

      <section className="admin-card danger-card">
        <h2>{t('admin.danger.title')}</h2>
        {parishCount > 0 ? (
          <p>{t('admin.dioceseSettings.deleteBlocked', { count: parishCount })}</p>
        ) : (
          <p>{t('admin.dioceseSettings.deleteHelp')}</p>
        )}
        <button
          type="button"
          className="button button-danger"
          disabled={parishCount > 0}
          onClick={() => setConfirming(true)}
        >
          {t('admin.dioceseSettings.delete')}
        </button>
      </section>

      {confirming && (
        <ConfirmDeleteDialog
          title={t('admin.dioceseSettings.deleteTitle', { name: savedName })}
          name={savedName}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await adminRequest(`/dioceses/${diocese.id}`, {
              method: 'DELETE',
              body: { confirmName: savedName },
            });
            await navigate('/admin');
          }}
        >
          <p>{t('admin.dioceseSettings.deleteWarning')}</p>
        </ConfirmDeleteDialog>
      )}
    </main>
  );
}

function Vicariates({ diocese }: { diocese: AdminDiocese }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [vicariates, setVicariates] = useState(diocese.vicariates);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  /** Runs a change, then reloads the list, so it always matches the database. */
  const change = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      const fresh = await adminRequest<AdminDiocese>(
        `/dioceses/${encodeURIComponent(diocese.slug)}`,
      );
      setVicariates(fresh.vicariates);
      setMessage({ ok: true, text: success });
      return true;
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const added = await change(
      () => adminRequest(`/dioceses/${diocese.id}/vicariates`, { body: { name: newName } }),
      t('admin.vicariates.added'),
    );
    if (added) setNewName('');
  };

  const move = (index: number, offset: -1 | 1) => {
    const ids = vicariates.map((vicariate) => vicariate.id);
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    void change(
      () =>
        adminRequest(`/dioceses/${diocese.id}/vicariates/order`, { method: 'PUT', body: { ids } }),
      t('admin.vicariates.reordered'),
    );
  };

  return (
    <section className="admin-card">
      <h2>{t('admin.vicariates.title')}</h2>
      {IMPORTED_DIOCESES.includes(diocese.slug) && (
        <p className="message message-warning">{t('admin.vicariates.importWarning')}</p>
      )}
      {vicariates.length === 0 ? (
        <p>{t('admin.vicariates.empty')}</p>
      ) : (
        <ol className="vicariate-list">
          {vicariates.map((vicariate, index) => (
            <VicariateRow
              key={`${vicariate.id}-${vicariate.name}`}
              vicariate={vicariate}
              busy={busy}
              isFirst={index === 0}
              isLast={index === vicariates.length - 1}
              onMove={(offset) => move(index, offset)}
              onRename={(name) =>
                change(
                  () =>
                    adminRequest(`/vicariates/${vicariate.id}`, {
                      method: 'PATCH',
                      body: { name },
                    }),
                  t('admin.vicariates.renamed'),
                )
              }
              onDelete={() =>
                void change(
                  () => adminRequest(`/vicariates/${vicariate.id}`, { method: 'DELETE', body: {} }),
                  t('admin.vicariates.deleted'),
                )
              }
            />
          ))}
        </ol>
      )}
      <form className="vicariate-add" onSubmit={(event) => void add(event)}>
        <label className="admin-field">
          <span>{t('admin.vicariates.newName')}</span>
          <input value={newName} required onChange={(event) => setNewName(event.target.value)} />
        </label>
        <button type="submit" className="button" disabled={busy}>
          {t('admin.vicariates.add')}
        </button>
      </form>
      {message && (
        <p className={`message ${message.ok ? 'message-success' : 'message-error'}`} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

function VicariateRow({
  vicariate,
  busy,
  isFirst,
  isLast,
  onMove,
  onRename,
  onDelete,
}: {
  vicariate: AdminVicariate;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (offset: -1 | 1) => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(vicariate.name);
  const inUse = vicariate.parishCount > 0;

  return (
    <li>
      <form
        className="vicariate-row"
        onSubmit={(event) => {
          event.preventDefault();
          void onRename(name);
        }}
      >
        <label className="admin-field">
          <span className="visually-hidden">{t('admin.vicariates.name')}</span>
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <small>{t('admin.vicariates.parishCount', { count: vicariate.parishCount })}</small>
        <button
          type="submit"
          className="button button-small"
          disabled={busy || name.trim() === vicariate.name}
        >
          {t('admin.vicariates.rename')}
        </button>
        <button
          type="button"
          className="button button-small"
          aria-label={t('admin.vicariates.moveUp', { name: vicariate.name })}
          disabled={busy || isFirst}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="button button-small"
          aria-label={t('admin.vicariates.moveDown', { name: vicariate.name })}
          disabled={busy || isLast}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="button button-small"
          aria-label={t('admin.vicariates.delete', { name: vicariate.name })}
          title={inUse ? t('admin.vicariates.inUse') : undefined}
          disabled={busy || inUse}
          onClick={onDelete}
        >
          {t('admin.vicariates.deleteShort')}
        </button>
      </form>
    </li>
  );
}
