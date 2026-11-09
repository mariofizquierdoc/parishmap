import type { PublicTerritoryCollection } from '@parishmap/shared';
import type { MultiPolygon } from 'geojson';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { boundsOf } from '../lib/bbox';
import { searchAddresses, type AddressResult } from '../lib/geocode';
import { pointInMultiPolygon, territoryAt } from '../lib/point-in-area';

/** What was found at a location. Coordinates stay in the browser: nothing is sent to our server. */
export interface FoundLocation {
  lng: number;
  lat: number;
  /** The published parish territory containing the point, if any. */
  parish: { slug: string; name: string } | null;
  insideDiocese: boolean;
}

interface Props {
  dioceseName: string;
  outline: MultiPolygon | null;
  territories: PublicTerritoryCollection;
  /** The current result, owned by the page so that choosing a parish by hand clears it. */
  found: FoundLocation | null;
  onFound: (found: FoundLocation) => void;
  onClear: () => void;
}

const MIN_QUERY_LENGTH = 3;
const SEARCH_DELAY_MS = 350;

type SearchState = 'idle' | 'searching' | 'done' | 'error';
type LocateError = 'permissionDenied' | 'locationError' | null;

export function FindMyParish({
  dioceseName,
  outline,
  territories,
  found,
  onFound,
  onClear,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [isListOpen, setIsListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState<LocateError>(null);

  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const bias = useMemo(
    () => boundsOf(outline ? [outline] : territories.features.map((f) => f.geometry)),
    [outline, territories],
  );

  // Searches as the visitor types, after a short pause. A new keystroke cancels the last request.
  const trimmed = query.trim();
  useEffect(() => {
    if (!isListOpen || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearchState('idle');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchState('searching');
      searchAddresses(trimmed, bias, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setActiveIndex(-1);
          setSearchState('done');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setSearchState('error');
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, bias, isListOpen]);

  function locate(lng: number, lat: number) {
    const territory = territoryAt(lng, lat, territories);
    onFound({
      lng,
      lat,
      parish: territory
        ? { slug: territory.properties.slug, name: territory.properties.name }
        : null,
      insideDiocese: territory !== null || !outline || pointInMultiPolygon(lng, lat, outline),
    });
  }

  function locateMe() {
    setLocateError(null);
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        locate(position.coords.longitude, position.coords.latitude);
      },
      (error) => {
        setIsLocating(false);
        setLocateError(
          error.code === error.PERMISSION_DENIED ? 'permissionDenied' : 'locationError',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function pick(result: AddressResult) {
    setQuery(result.label);
    setIsListOpen(false);
    setLocateError(null);
    locate(result.lng, result.lat);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setIsListOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      const choice = suggestions[activeIndex] ?? (suggestions.length === 1 ? suggestions[0] : null);
      if (choice && isListOpen) {
        event.preventDefault();
        pick(choice);
      }
    } else if (event.key === 'Escape' && isListOpen) {
      event.preventDefault();
      setIsListOpen(false);
    }
  }

  function close() {
    setIsOpen(false);
    setIsListOpen(false);
    setLocateError(null);
    onClear();
  }

  function searchAgain() {
    onClear();
    setQuery('');
    setLocateError(null);
    // Waits for the inputs to show again before moving focus.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (!isOpen) {
    return (
      <div className="find">
        <button type="button" className="find-button" onClick={() => setIsOpen(true)}>
          {t('find.button')}
        </button>
      </div>
    );
  }

  const listId = `${id}-suggestions`;
  const showList = isListOpen && trimmed.length >= MIN_QUERY_LENGTH && searchState !== 'idle';
  let searchMessage: string | null = null;
  if (showList && searchState === 'searching') searchMessage = t('find.searching');
  if (showList && searchState === 'done' && suggestions.length === 0) {
    searchMessage = t('find.noResults');
  }
  if (showList && searchState === 'error') searchMessage = t('find.searchError');

  return (
    <section className="find find-panel" aria-labelledby={`${id}-title`}>
      <div className="details-heading">
        <h2 id={`${id}-title`}>{t('find.button')}</h2>
        <button type="button" className="close" aria-label={t('find.close')} onClick={close}>
          ×
        </button>
      </div>

      {found ? (
        <div className="find-result" role="status">
          <p>
            {found.parish ? (
              <strong>{t('find.result', { name: found.parish.name })}</strong>
            ) : found.insideDiocese ? (
              t('find.notMapped')
            ) : (
              t('find.outside', { diocese: dioceseName })
            )}
          </p>
          <button type="button" className="link-button" onClick={searchAgain}>
            {t('find.again')}
          </button>
        </div>
      ) : (
        <>
          {canLocate && (
            <button
              type="button"
              className="secondary-button"
              onClick={locateMe}
              disabled={isLocating}
            >
              {isLocating ? t('find.locating') : t('find.useLocation')}
            </button>
          )}
          {locateError && (
            <p className="find-error" role="alert">
              {t(`find.${locateError}`)}
            </p>
          )}

          <div>
            <label className="field" htmlFor={`${id}-address`}>
              <span>{t('find.addressLabel')}</span>
            </label>
            <div className="combobox">
              <input
                ref={inputRef}
                id={`${id}-address`}
                className="combobox-input"
                type="text"
                role="combobox"
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={showList && suggestions.length > 0}
                aria-controls={listId}
                aria-activedescendant={
                  activeIndex >= 0 && suggestions[activeIndex]
                    ? `${listId}-${activeIndex}`
                    : undefined
                }
                placeholder={t('find.addressPlaceholder')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIsListOpen(true);
                }}
                onKeyDown={onKeyDown}
                onFocus={() => setIsListOpen(true)}
                onBlur={() => setIsListOpen(false)}
              />
              <ul
                id={listId}
                role="listbox"
                className="suggestions"
                aria-label={t('find.addressLabel')}
                hidden={!showList || suggestions.length === 0}
              >
                {suggestions.map((result, index) => (
                  <li
                    key={result.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    // Picks before the input's blur closes the list.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(result);
                    }}
                  >
                    {result.label}
                  </li>
                ))}
              </ul>
            </div>
            <p className="find-hint" role="status">
              {searchMessage}
            </p>
          </div>
          <p className="find-attribution">{t('find.attribution')}</p>
        </>
      )}
    </section>
  );
}
