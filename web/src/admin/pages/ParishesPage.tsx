import type { AdminDiocese, AdminParish, AdminProgress } from '@parishmap/shared/admin';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { normalizeForSearch } from '../../lib/search';
import { adminRequest } from '../api';
import { OverviewMap } from '../components/OverviewMap';

const FILTERS = ['all', 'missing', 'draft', 'approximate', 'confirmed', 'noTerritory'] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(parish: AdminParish, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'missing':
      return parish.hasTerritory && !parish.hasDraft && !parish.hasPublished;
    case 'draft':
      return parish.hasTerritory && parish.hasUnpublishedChanges;
    case 'approximate':
      return parish.hasTerritory && parish.hasPublished && parish.confidence === 'APPROXIMATE';
    case 'confirmed':
      return parish.hasTerritory && parish.hasPublished && parish.confidence === 'CONFIRMED';
    case 'noTerritory':
      return !parish.hasTerritory;
  }
}

function StatusBadge({ parish }: { parish: AdminParish }) {
  const { t } = useTranslation();
  if (!parish.hasTerritory) return <span className="badge">{t('admin.status.noTerritory')}</span>;
  if (!parish.hasDraft && !parish.hasPublished) {
    return <span className="badge badge-missing">{t('admin.status.missing')}</span>;
  }
  if (!parish.hasPublished) {
    return <span className="badge badge-draft">{t('admin.status.draft')}</span>;
  }
  return (
    <>
      <span className="badge badge-published">
        {t('admin.status.published')}
        {parish.confidence && ` (${t(`admin.status.${parish.confidence}`)})`}
      </span>
      {parish.hasUnpublishedChanges && (
        <span className="badge badge-draft">{t('admin.status.changes')}</span>
      )}
    </>
  );
}

export function ParishesPage() {
  const { t } = useTranslation();
  const { dioceseSlug = '' } = useParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { state, retry } = useLoad(dioceseSlug, async (signal) => {
    const base = `/dioceses/${encodeURIComponent(dioceseSlug)}`;
    const [diocese, progress] = await Promise.all([
      adminRequest<AdminDiocese>(base, { signal }),
      adminRequest<AdminProgress>(`${base}/progress`, { signal }),
    ]);
    return { diocese, progress };
  });

  const parishes = state.status === 'ready' ? state.data.diocese.parishes : null;
  const filtered = useMemo(() => {
    const words = normalizeForSearch(query).split(' ').filter(Boolean);
    return (parishes ?? []).filter(
      (parish) =>
        matchesFilter(parish, filter) &&
        words.every((word) => normalizeForSearch(parish.name).includes(word)),
    );
  }, [parishes, query, filter]);

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return state.notFound ? (
      <StatusMessage>{t('common.notFound')}</StatusMessage>
    ) : (
      <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>
    );
  }

  const { diocese, progress } = state.data;

  return (
    <main className="admin-main">
      <div className="admin-title-row">
        <h1>{diocese.name}</h1>
        <div className="button-row">
          <Link className="button" to={`/admin/${diocese.slug}/outline`}>
            {t('admin.list.outline')}
          </Link>
          <a
            className="button"
            href={`/api/admin/dioceses/${diocese.slug}/export`}
            download={`${diocese.slug}.geojson`}
          >
            {t('admin.list.exportAll')}
          </a>
        </div>
      </div>

      <p data-testid="progress">
        {t('admin.progress.summary', {
          published: progress.published,
          draftOnly: progress.draftOnly,
          notStarted: progress.notStarted,
          noTerritory: progress.noTerritory,
        })}
      </p>
      {!progress.outlineDrawn && (
        <p className="message message-warning">{t('admin.progress.noOutline')}</p>
      )}
      {progress.outlineDrawn && (
        <p className={progress.gaps ? 'message message-warning' : 'message message-success'}>
          {t(progress.gaps ? 'admin.progress.gaps' : 'admin.progress.covered')}
        </p>
      )}

      <div className="overview-map">
        <OverviewMap progress={progress} dioceseSlug={diocese.slug} />
      </div>

      <div className="filter-row" role="group">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {t(`admin.list.filters.${option}`)} (
            {diocese.parishes.filter((parish) => matchesFilter(parish, option)).length})
          </button>
        ))}
      </div>

      <label className="admin-field">
        <span className="visually-hidden">{t('admin.list.search')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('admin.list.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filtered.length === 0 ? (
        <p>{t('admin.list.noResults')}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.list.columns.name')}</th>
              <th>{t('admin.list.columns.vicariate')}</th>
              <th>{t('admin.list.columns.status')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((parish) => (
              <tr key={parish.id}>
                <td>
                  <Link to={`/admin/${diocese.slug}/parishes/${parish.id}`}>{parish.name}</Link>
                  {!parish.isPublished && <span className="badge">{t('admin.status.hidden')}</span>}
                </td>
                <td>{parish.vicariate}</td>
                <td>
                  <StatusBadge parish={parish} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
