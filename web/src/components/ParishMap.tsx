import type { PublicTerritoryCollection } from '@parishmap/shared';
import type { MultiPolygon } from 'geojson';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { boundsOf } from '../lib/bbox';
import '../lib/maplibre-setup';
import { DEFAULT_CENTER, DEFAULT_ZOOM, STREET_STYLE_URL } from '../lib/map-style';

const COLOR_PARISH = '#2b6a8f';
const COLOR_SELECTED = '#d9480f';
const COLOR_OUTLINE = '#37474f';
const COLOR_LOCATION = '#1d2a33';
/** Street level, so the visitor can recognize the place they searched for. */
const LOCATION_ZOOM = 15;

export interface MapLocation {
  lng: number;
  lat: number;
}

interface Props {
  outline: MultiPolygon | null;
  territories: PublicTerritoryCollection;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  /** A place found with "Encuentra mi parroquia". The map centers on it and shows a pin. */
  location?: MapLocation | null;
}

export function ParishMap({ outline, territories, selectedSlug, onSelect, location }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const [isLoaded, setIsLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STREET_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    let styleLoaded = false;
    // Individual tile errors are harmless. Only a failed style leaves the map unusable.
    map.on('error', () => {
      if (!styleLoaded) setFailed(true);
    });

    map.on('load', () => {
      styleLoaded = true;
      setFailed(false);

      map.addSource('diocese', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('parishes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'slug',
      });

      const isSelected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
      map.addLayer({
        id: 'parish-fill',
        type: 'fill',
        source: 'parishes',
        paint: {
          'fill-color': ['case', isSelected, COLOR_SELECTED, COLOR_PARISH],
          'fill-opacity': ['case', isSelected, 0.5, 0.12],
        },
      });
      map.addLayer({
        id: 'parish-line',
        type: 'line',
        source: 'parishes',
        paint: {
          'line-color': ['case', isSelected, COLOR_SELECTED, COLOR_PARISH],
          // A thicker line means the selection doesn't rely on color alone.
          'line-width': ['case', isSelected, 3, 1],
        },
      });
      map.addLayer({
        id: 'diocese-line',
        type: 'line',
        source: 'diocese',
        paint: { 'line-color': COLOR_OUTLINE, 'line-width': 2, 'line-dasharray': [3, 2] },
      });

      map.on('click', 'parish-fill', (event) => {
        const slug = event.features?.[0]?.properties?.slug as string | undefined;
        if (slug) onSelectRef.current(slug);
      });
      map.on('mouseenter', 'parish-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'parish-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      setIsLoaded(true);
    });

    if (import.meta.env.DEV) {
      (window as unknown as { __parishMap?: MapLibreMap }).__parishMap = map;
    }

    return () => {
      setIsLoaded(false);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    (map.getSource('parishes') as GeoJSONSource).setData(territories);
    (map.getSource('diocese') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: outline ? [{ type: 'Feature', geometry: outline, properties: {} }] : [],
    });
  }, [isLoaded, outline, territories]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded || !selectedSlug) return;
    const target = { source: 'parishes', id: selectedSlug };
    map.setFeatureState(target, { selected: true });
    return () => {
      // The map may already be gone if the page is closing.
      if (mapRef.current === map) map.removeFeatureState(target, 'selected');
    };
  }, [isLoaded, selectedSlug]);

  const overviewBounds = useMemo(
    () => boundsOf(outline ? [outline] : territories.features.map((feature) => feature.geometry)),
    [outline, territories],
  );

  const hasLocation = Boolean(location);

  useEffect(() => {
    const map = mapRef.current;
    // A searched location takes priority: the map stays centered on it.
    if (!map || !isLoaded || hasLocation) return;
    const selected = territories.features.find((f) => f.properties.slug === selectedSlug);
    const bounds = selected ? boundsOf([selected.geometry]) : overviewBounds;
    if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 16 });
  }, [isLoaded, selectedSlug, territories, overviewBounds, hasLocation]);

  const markerLabel = t('find.marker');

  // Runs for every new search, even of the same place, so the map always comes back to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded || !location) return;
    const { lng, lat } = location;
    const marker = new Marker({ color: COLOR_LOCATION }).setLngLat([lng, lat]).addTo(map);
    const element = marker.getElement();
    element.classList.add('location-marker');
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', markerLabel);
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), LOCATION_ZOOM) });
    return () => {
      marker.remove();
    };
  }, [isLoaded, location, markerLabel]);

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="map" role="region" aria-label={t('map.label')} />
      {failed && (
        <p className="map-error" role="alert">
          {t('map.loadError')}
        </p>
      )}
    </div>
  );
}
