import type {
  PublicDiocese,
  PublicDioceseSummary,
  PublicParishList,
  PublicTerritoryCollection,
} from '@parishmap/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { FindMyParish, type FoundLocation } from '../components/FindMyParish';
import { ParishDetails } from '../components/ParishDetails';
import { ParishList } from '../components/ParishList';
import { ParishMap } from '../components/ParishMap';
import { StatusMessage } from '../components/StatusMessage';
import { getJson, useLoad } from '../lib/api';

interface PageData {
  dioceses: PublicDioceseSummary[];
  diocese: PublicDiocese;
  parishes: PublicParishList;
  territories: PublicTerritoryCollection;
}

function loadPageData(slug: string, signal: AbortSignal): Promise<PageData> {
  const base = `/api/dioceses/${encodeURIComponent(slug)}`;
  return Promise.all([
    getJson<PublicDioceseSummary[]>('/api/dioceses', signal),
    getJson<PublicDiocese>(base, signal),
    getJson<PublicParishList>(`${base}/parishes`, signal),
    getJson<PublicTerritoryCollection>(`${base}/territories`, signal),
  ]).then(([dioceses, diocese, parishes, territories]) => ({
    dioceses,
    diocese,
    parishes,
    territories,
  }));
}

export function DiocesePage() {
  const { t } = useTranslation();
  const { dioceseSlug = '', parishSlug } = useParams();
  const { state, retry } = useLoad(dioceseSlug, (signal) => loadPageData(dioceseSlug, signal));

  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return state.notFound ? (
      <StatusMessage>
        {t('common.notFound')} <Link to="/">{t('common.goHome')}</Link>
      </StatusMessage>
    ) : (
      <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>
    );
  }

  return <DioceseView data={state.data} parishSlug={parishSlug} />;
}

function DioceseView({ data, parishSlug }: { data: PageData; parishSlug: string | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { dioceses, diocese, parishes, territories } = data;

  const allParishes = useMemo(
    () => parishes.vicariates.flatMap((vicariate) => vicariate.parishes),
    [parishes],
  );
  const selected = allParishes.find((parish) => parish.slug === parishSlug);
  const selectedName = selected?.name;

  useEffect(() => {
    document.title = selectedName
      ? `${selectedName} · ${diocese.name}`
      : `${diocese.name} · ${t('app.name')}`;
  }, [selectedName, diocese.name, t]);

  // A place found with "Encuentra mi parroquia". Kept only in memory, never in the URL.
  const [found, setFound] = useState<FoundLocation | null>(null);

  const goTo = useCallback(
    (slug: string | null) => {
      void navigate(slug ? `/${diocese.slug}/${slug}` : `/${diocese.slug}`);
    },
    [navigate, diocese.slug],
  );

  /** A choice made by hand replaces any searched location. */
  const select = useCallback(
    (slug: string | null) => {
      setFound(null);
      goTo(slug);
    },
    [goTo],
  );

  const showFound = useCallback(
    (result: FoundLocation) => {
      setFound(result);
      goTo(result.parish?.slug ?? null);
    },
    [goTo],
  );

  // Going back or forward in the browser selects a different parish, so the result no longer
  // applies. This runs only when the URL changes: right after a search, the URL may still show
  // the previous parish for one render.
  useEffect(() => {
    setFound((current) =>
      current && (current.parish?.slug ?? null) !== (parishSlug ?? null) ? null : current,
    );
  }, [parishSlug]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <p className="brand">{t('app.name')}</p>
          <label className="field">
            <span>{t('diocese.select')}</span>
            <select
              value={diocese.slug}
              onChange={(event) => void navigate(`/${event.target.value}`)}
            >
              {dioceses.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        <FindMyParish
          dioceseName={diocese.name}
          outline={diocese.outline}
          territories={territories}
          found={found}
          onFound={showFound}
          onClear={() => setFound(null)}
        />

        {selected && <ParishDetails parish={selected} onClose={() => select(null)} />}
        {parishSlug && !selected && (
          <section className="details" role="status">
            <p>{t('parish.notFound')}</p>
          </section>
        )}

        <div className="sidebar-scroll">
          <ParishList
            vicariates={parishes.vicariates}
            selectedSlug={parishSlug}
            onSelect={select}
          />

          <footer className="sidebar-footer">
            <p>{t('footer.disclaimer')}</p>
            {diocese.sourceUrl && (
              <p>
                <a href={diocese.sourceUrl} target="_blank" rel="noreferrer">
                  {t('footer.source')}
                </a>
              </p>
            )}
          </footer>
        </div>
      </aside>

      <div className="map-pane">
        <ParishMap
          outline={diocese.outline}
          territories={territories}
          selectedSlug={selected?.hasPublishedTerritory ? selected.slug : null}
          onSelect={select}
          location={found}
        />
      </div>
    </div>
  );
}
