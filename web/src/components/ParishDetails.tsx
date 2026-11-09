import type { PublicParish } from '@parishmap/shared';
import { useTranslation } from 'react-i18next';

/** Website addresses are typed in by hand, so only allow real web links. */
function safeWebsite(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function ParishDetails({ parish, onClose }: { parish: PublicParish; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const website = parish.website ? safeWebsite(parish.website) : null;

  return (
    <section className="details" aria-labelledby="parish-name">
      <div className="details-heading">
        <h1 id="parish-name">{parish.name}</h1>
        <button type="button" className="close" aria-label={t('parish.close')} onClick={onClose}>
          ×
        </button>
      </div>

      <dl>
        <dt>{t('parish.vicariate')}</dt>
        <dd>{parish.vicariate}</dd>
        {parish.priest && (
          <>
            <dt>{t('parish.priest')}</dt>
            <dd>{parish.priest}</dd>
          </>
        )}
        {parish.address && (
          <>
            <dt>{t('parish.address')}</dt>
            <dd>{parish.address}</dd>
          </>
        )}
        {parish.phone && (
          <>
            <dt>{t('parish.phone')}</dt>
            <dd>
              <a href={`tel:${parish.phone.replace(/[^\d+]/g, '')}`}>{parish.phone}</a>
            </dd>
          </>
        )}
        {parish.email && (
          <>
            <dt>{t('parish.email')}</dt>
            <dd>
              <a href={`mailto:${parish.email}`}>{parish.email}</a>
            </dd>
          </>
        )}
        {website && (
          <>
            <dt>{t('parish.website')}</dt>
            <dd>
              <a href={website} target="_blank" rel="noreferrer">
                {website}
              </a>
            </dd>
          </>
        )}
      </dl>

      {!parish.hasTerritory && <p className="territory-note">{t('parish.noTerritory')}</p>}
      {parish.hasTerritory && !parish.hasPublishedTerritory && (
        <p className="territory-note">{t('parish.areaUnavailable')}</p>
      )}
      {parish.hasPublishedTerritory && parish.confidence && (
        <p className="territory-note">
          <strong>{t(`parish.confidence.${parish.confidence}`)}</strong>
          {parish.territoryUpdatedAt && (
            <>
              {' · '}
              {t('parish.updated', {
                date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
                  new Date(parish.territoryUpdatedAt),
                ),
              })}
            </>
          )}
        </p>
      )}
    </section>
  );
}
