import type { AdminProgress } from '@parishmap/shared/admin';
import type { FeatureCollection } from 'geojson';
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { boundsOf } from '../../lib/bbox';
import '../../lib/maplibre-setup';
import { DEFAULT_CENTER, DEFAULT_ZOOM, STREET_STYLE_URL } from '../../lib/map-style';

/** Read-only view of every shape so far, with uncovered areas in red. */
export function OverviewMap({
  progress,
  dioceseSlug,
}: {
  progress: AdminProgress;
  dioceseSlug: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STREET_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      const shapes: FeatureCollection = {
        type: 'FeatureCollection',
        features: progress.shapes.map((shape) => ({
          type: 'Feature',
          geometry: shape.geometry,
          properties: { id: shape.id },
        })),
      };
      const single = (geometry: AdminProgress['gaps']): FeatureCollection => ({
        type: 'FeatureCollection',
        features: geometry ? [{ type: 'Feature', geometry, properties: {} }] : [],
      });

      map.addSource('gaps', { type: 'geojson', data: single(progress.gaps) });
      map.addSource('shapes', { type: 'geojson', data: shapes });
      map.addSource('outline', { type: 'geojson', data: single(progress.outline) });

      map.addLayer({
        id: 'gaps-fill',
        type: 'fill',
        source: 'gaps',
        paint: { 'fill-color': '#c92a2a', 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: 'shapes-fill',
        type: 'fill',
        source: 'shapes',
        paint: { 'fill-color': '#2b6a8f', 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: 'shapes-line',
        type: 'line',
        source: 'shapes',
        paint: { 'line-color': '#2b6a8f', 'line-width': 1 },
      });
      map.addLayer({
        id: 'outline-line',
        type: 'line',
        source: 'outline',
        paint: { 'line-color': '#37474f', 'line-width': 2, 'line-dasharray': [3, 2] },
      });

      map.on('click', 'shapes-fill', (event) => {
        const id = event.features?.[0]?.properties?.id as number | undefined;
        if (id) void navigate(`/admin/${dioceseSlug}/parishes/${id}`);
      });

      const bounds = boundsOf(
        progress.outline ? [progress.outline] : progress.shapes.map((shape) => shape.geometry),
      );
      if (bounds) map.fitBounds(bounds, { padding: 32, duration: 0 });
    });

    return () => map.remove();
  }, [progress, dioceseSlug, navigate]);

  return <div ref={containerRef} className="map" />;
}
