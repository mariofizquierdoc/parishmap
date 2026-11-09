import type { PublicDioceseSummary } from '@parishmap/shared';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { StatusMessage } from '../components/StatusMessage';
import { getJson, useLoad } from '../lib/api';

export function HomePage() {
  const { t } = useTranslation();
  const { state, retry } = useLoad('dioceses', (signal) =>
    getJson<PublicDioceseSummary[]>('/api/dioceses', signal),
  );

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>;
  }

  const dioceses = state.data;
  // With a single diocese there's nothing to choose, so go straight to it.
  if (dioceses.length === 1) return <Navigate to={`/${dioceses[0]!.slug}`} replace />;
  if (dioceses.length === 0) return <StatusMessage>{t('home.empty')}</StatusMessage>;

  return (
    <main className="home">
      <h1>{t('home.title')}</h1>
      <ul>
        {dioceses.map((diocese) => (
          <li key={diocese.slug}>
            <Link to={`/${diocese.slug}`}>{diocese.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
