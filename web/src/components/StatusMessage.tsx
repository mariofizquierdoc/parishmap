import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function StatusMessage({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <main className="status" role="status">
      <p>{children}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </main>
  );
}
