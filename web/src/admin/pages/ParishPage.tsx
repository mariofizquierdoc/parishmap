import type { AdminConfig, AdminDiocese, AdminParish } from '@parishmap/shared/admin';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { adminRequest, AdminApiError } from '../api';
import { BoundaryEditor } from '../components/BoundaryEditor';

export function ParishPage() {
  const { t } = useTranslation();
  const { dioceseSlug = '', parishId = '' } = useParams();

  const { state, retry } = useLoad(`${dioceseSlug}/${parishId}`, async (signal) => {
    const [diocese, config] = await Promise.all([
      adminRequest<AdminDiocese>(`/dioceses/${encodeURIComponent(dioceseSlug)}`, { signal }),
      adminRequest<AdminConfig>('/config', { signal }),
    ]);
    return { diocese, config };
  });

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return state.notFound ? (
      <StatusMessage>{t('common.notFound')}</StatusMessage>
    ) : (
      <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>
    );
  }

  const { diocese, config } = state.data;
  const parish = diocese.parishes.find((item) => String(item.id) === parishId);
  if (!parish) return <StatusMessage>{t('parish.notFound')}</StatusMessage>;

  return <ParishView key={parish.id} diocese={diocese} parish={parish} config={config} />;
}

const TEXT_FIELDS = ['address', 'phone', 'email', 'website', 'priest'] as const;

function ParishView({
  diocese,
  parish,
  config,
}: {
  diocese: AdminDiocese;
  parish: AdminParish;
  config: AdminConfig;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: parish.name,
    vicariateId: parish.vicariateId,
    hasTerritory: parish.hasTerritory,
    isPublished: parish.isPublished,
    address: parish.address ?? '',
    phone: parish.phone ?? '',
    email: parish.email ?? '',
    website: parish.website ?? '',
    priest: parish.priest ?? '',
  });
  const [savedHasTerritory, setSavedHasTerritory] = useState(parish.hasTerritory);
  const [savedName, setSavedName] = useState(parish.name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await adminRequest(`/parishes/${parish.id}`, { method: 'PATCH', body: form });
      setSavedHasTerritory(form.hasTerritory);
      setSavedName(form.name);
      setMessage({ ok: true, text: t('admin.parish.saved') });
    } catch (error) {
      const code = error instanceof AdminApiError ? error.body.error : 'generic';
      setMessage({ ok: false, text: t(`admin.errors.${code}`, t('admin.errors.generic')) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-main">
      <Link to={`/admin/${diocese.slug}`}>← {t('admin.back')}</Link>
      <h1>{savedName}</h1>

      {savedHasTerritory ? (
        <BoundaryEditor
          kind="parish"
          ownerId={parish.id}
          satellite={config.satellite}
          exportHref={`/api/admin/dioceses/${diocese.slug}/export?parish=${parish.id}`}
        />
      ) : (
        <p className="message message-warning">{t('admin.parish.noTerritory')}</p>
      )}

      <section className="admin-card">
        <h2>{t('admin.parish.details')}</h2>
        <form className="parish-form" onSubmit={(event) => void save(event)}>
          <label className="admin-field">
            <span>{t('admin.parish.name')}</span>
            <input
              value={form.name}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          {parish.sourceName && (
            <p className="source-name">
              {t('admin.parish.sourceName')}: <q>{parish.sourceName}</q>
            </p>
          )}
          <label className="admin-field">
            <span>{t('admin.parish.vicariate')}</span>
            <select
              value={form.vicariateId}
              onChange={(event) => setForm({ ...form, vicariateId: Number(event.target.value) })}
            >
              {diocese.vicariates.map((vicariate) => (
                <option key={vicariate.id} value={vicariate.id}>
                  {vicariate.name}
                </option>
              ))}
            </select>
          </label>
          {TEXT_FIELDS.map((field) => (
            <label className="admin-field" key={field}>
              <span>{t(`admin.parish.${field}`)}</span>
              <input
                value={form[field]}
                onChange={(event) => setForm({ ...form, [field]: event.target.value })}
              />
            </label>
          ))}
          <label className="admin-check">
            <input
              type="checkbox"
              checked={form.hasTerritory}
              onChange={(event) => setForm({ ...form, hasTerritory: event.target.checked })}
            />
            <span>
              {t('admin.parish.hasTerritory')}
              <small>{t('admin.parish.hasTerritoryHelp')}</small>
            </span>
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
            />
            <span>{t('admin.parish.isPublished')}</span>
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
            {t('admin.parish.save')}
          </button>
        </form>
      </section>
    </main>
  );
}
