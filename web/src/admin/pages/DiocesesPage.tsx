import type { AdminDioceseSummary } from '@parishmap/shared/admin';
import { slugify } from '@parishmap/shared/slug';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { adminRequest, errorCode } from '../api';

export function DiocesesPage() {
  const { t } = useTranslation();
  const { state, retry } = useLoad('admin-dioceses', (signal) =>
    adminRequest<AdminDioceseSummary[]>('/dioceses', { signal }),
  );

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>;
  }

  const dioceses = state.data;

  return (
    <main className="admin-main">
      <h1>{t('admin.dioceses.title')}</h1>
      {dioceses.length === 0 ? (
        <p>{t('admin.dioceses.empty')}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.dioceses.columns.name')}</th>
              <th>{t('admin.dioceses.columns.parishes')}</th>
              <th>{t('admin.dioceses.columns.status')}</th>
              <th>
                <span className="visually-hidden">{t('admin.dioceses.columns.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dioceses.map((diocese) => (
              <tr key={diocese.id}>
                <td>
                  <Link to={`/admin/${diocese.slug}`}>{diocese.name}</Link>
                  <small className="slug-hint"> /{diocese.slug}</small>
                </td>
                <td>{diocese.parishCount}</td>
                <td>
                  {diocese.isPublished ? (
                    <span className="badge badge-published">{t('admin.dioceses.published')}</span>
                  ) : (
                    <span className="badge">{t('admin.status.hidden')}</span>
                  )}
                </td>
                <td>
                  <Link to={`/admin/${diocese.slug}/settings`}>{t('admin.dioceses.settings')}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewDioceseForm />
    </main>
  );
}

function NewDioceseForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // The slug follows the name until the admin edits it.
  const [slugEdited, setSlugEdited] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shownSlug = slugEdited ? slug : slugify(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await adminRequest<{ slug: string }>('/dioceses', {
        body: { name, slug: shownSlug, sourceUrl, isPublished },
      });
      await navigate(`/admin/${created.slug}/settings`);
    } catch (caught) {
      setError(t(`admin.errors.${errorCode(caught)}`, t('admin.errors.generic')));
      setBusy(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>{t('admin.dioceses.new')}</h2>
      <form className="parish-form" onSubmit={(event) => void submit(event)}>
        <label className="admin-field">
          <span>{t('admin.dioceses.name')}</span>
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="admin-field">
          <span>{t('admin.dioceses.slug')}</span>
          <input
            value={shownSlug}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={60}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value);
            }}
          />
        </label>
        <p className="source-name">
          {t('admin.dioceses.slugHelp', { url: `${window.location.origin}/${shownSlug}` })}
        </p>
        <label className="admin-field">
          <span>{t('admin.dioceses.sourceUrl')}</span>
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
        </label>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(event) => setIsPublished(event.target.checked)}
          />
          <span>
            {t('admin.dioceses.isPublished')}
            <small>{t('admin.dioceses.isPublishedHelp')}</small>
          </span>
        </label>
        {error && (
          <p className="message message-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={busy}>
          {t('admin.dioceses.create')}
        </button>
      </form>
    </section>
  );
}
