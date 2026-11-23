import type { AdminDiocese } from '@parishmap/shared/admin';
import { slugify } from '@parishmap/shared/slug';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { adminRequest, errorCode } from '../api';
import { PARISH_TEXT_FIELDS } from '../parish-fields';

export function NewParishPage() {
  const { t } = useTranslation();
  const { dioceseSlug = '' } = useParams();
  const { state, retry } = useLoad(`new-parish/${dioceseSlug}`, (signal) =>
    adminRequest<AdminDiocese>(`/dioceses/${encodeURIComponent(dioceseSlug)}`, { signal }),
  );

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>;
  }
  return <NewParishForm diocese={state.data} />;
}

function NewParishForm({ diocese }: { diocese: AdminDiocese }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    vicariateId: diocese.vicariates[0]?.id ?? 0,
    hasTerritory: true,
    isPublished: true,
    address: '',
    phone: '',
    email: '',
    website: '',
    priest: '',
  });
  // Left empty, the server picks a free slug from the name.
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const back = <Link to={`/admin/${diocese.slug}`}>← {t('admin.back')}</Link>;

  if (diocese.vicariates.length === 0) {
    return (
      <main className="admin-main">
        {back}
        <h1>{t('admin.newParish.title')}</h1>
        <p className="message message-warning">
          {t('admin.newParish.noVicariates')}{' '}
          <Link to={`/admin/${diocese.slug}/settings`}>{t('admin.list.settings')}</Link>
        </p>
      </main>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await adminRequest<{ id: number }>(`/dioceses/${diocese.id}/parishes`, {
        body: { ...form, ...(slug.trim() ? { slug: slug.trim() } : {}) },
      });
      await navigate(`/admin/${diocese.slug}/parishes/${created.id}`);
    } catch (caught) {
      setError(t(`admin.errors.${errorCode(caught)}`, t('admin.errors.generic')));
      setBusy(false);
    }
  };

  return (
    <main className="admin-main">
      {back}
      <h1>{t('admin.newParish.title')}</h1>
      <section className="admin-card">
        <form className="parish-form" onSubmit={(event) => void submit(event)}>
          <label className="admin-field">
            <span>{t('admin.parish.name')}</span>
            <input
              value={form.name}
              required
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="admin-field">
            <span>{t('admin.newParish.slug')}</span>
            <input
              value={slug}
              placeholder={slugify(form.name)}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={60}
              onChange={(event) => setSlug(event.target.value)}
            />
          </label>
          <p className="source-name">{t('admin.newParish.slugHelp')}</p>
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
          {PARISH_TEXT_FIELDS.map((field) => (
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
          {error && (
            <p className="message message-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={busy}>
            {t('admin.newParish.create')}
          </button>
        </form>
      </section>
    </main>
  );
}
