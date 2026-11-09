import type { PublicVicariate } from '@parishmap/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterVicariates } from '../lib/search';

interface Props {
  vicariates: PublicVicariate[];
  selectedSlug: string | undefined;
  onSelect: (slug: string) => void;
}

export function ParishList({ vicariates, selectedSlug, onSelect }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const selectedRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => filterVicariates(vicariates, query), [vicariates, query]);
  const count = filtered.reduce((total, vicariate) => total + vicariate.parishes.length, 0);

  // Keeps the selection visible when it was made by clicking the map.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedSlug]);

  return (
    <section className="parish-list">
      <label className="field">
        <span className="visually-hidden">{t('list.searchLabel')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('list.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="list-count" role="status">
        {t('list.count', { count })}
      </p>

      {filtered.length === 0 && <p className="list-empty">{t('list.noResults')}</p>}

      {filtered.map((vicariate) => (
        <section key={vicariate.name}>
          <h2>{t('list.vicariate', { name: vicariate.name })}</h2>
          <ul>
            {vicariate.parishes.map((parish) => {
              const isSelected = parish.slug === selectedSlug;
              return (
                <li key={parish.slug}>
                  <button
                    type="button"
                    className="parish-button"
                    aria-current={isSelected ? 'true' : undefined}
                    ref={isSelected ? selectedRef : undefined}
                    onClick={() => onSelect(parish.slug)}
                  >
                    <span>{parish.name}</span>
                    {parish.hasPublishedTerritory && (
                      <span className="mapped-dot" role="img" aria-label={t('list.mapped')} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
