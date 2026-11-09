import type { AdminConfig, AdminDiocese } from '@parishmap/shared/admin';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { adminRequest } from '../api';
import { BoundaryEditor } from '../components/BoundaryEditor';

export function OutlinePage() {
  const { t } = useTranslation();
  const { dioceseSlug = '' } = useParams();

  const { state, retry } = useLoad(dioceseSlug, async (signal) => {
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

  return (
    <main className="admin-main">
      <Link to={`/admin/${diocese.slug}`}>← {t('admin.back')}</Link>
      <h1>{t('admin.editor.outlineTitle', { name: diocese.name })}</h1>
      <BoundaryEditor kind="diocese" ownerId={diocese.id} satellite={config.satellite} />
    </main>
  );
}
