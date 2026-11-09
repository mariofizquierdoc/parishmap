import { joinHoles, splitHoles, type EditableShape } from '@parishmap/shared/geometry';
import type {
  AdminTerritory,
  ApiErrorBody,
  OverlapReport,
  SatelliteConfig,
  TerritoryChecks,
  TerritoryOwnerKind,
  TerritoryVersionSummary,
} from '@parishmap/shared/admin';
import type { Confidence } from '@parishmap/shared';
import type { FeatureCollection, MultiPolygon, Position } from 'geojson';
import { Map as MapLibreMap, NavigationControl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type SnapToCustom,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { StatusMessage } from '../../components/StatusMessage';
import { useLoad } from '../../lib/api';
import { boundsOf } from '../../lib/bbox';
import '../../lib/maplibre-setup';
import { DEFAULT_CENTER, DEFAULT_ZOOM, STREET_STYLE_URL } from '../../lib/map-style';
import { adminRequest, AdminApiError } from '../api';
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from '../history';
import { findSnapPoint, prepareSnapRings } from '../snapping';

interface Props {
  kind: TerritoryOwnerKind;
  ownerId: number;
  satellite: SatelliteConfig | null;
  exportHref?: string;
}

type Mode = 'select' | 'polygon';
type Message = { type: 'success' | 'error' | 'warning'; text: string };

const EMPTY_SHAPE: EditableShape = { parts: [], holes: [] };

const collection = (geometries: (MultiPolygon | null)[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: geometries.flatMap((geometry) =>
    geometry ? [{ type: 'Feature' as const, geometry, properties: {} }] : [],
  ),
});

const shapeOf = (territory: AdminTerritory): EditableShape => {
  const geometry = territory.draft ?? territory.published;
  return geometry ? splitHoles(geometry) : EMPTY_SHAPE;
};

export function BoundaryEditor(props: Props) {
  const { t } = useTranslation();
  const { state, retry } = useLoad(`${props.kind}/${props.ownerId}`, (signal) =>
    adminRequest<AdminTerritory>(`/territories/${props.kind}/${props.ownerId}`, { signal }),
  );
  if (state.status === 'loading') return <StatusMessage>{t('common.loading')}</StatusMessage>;
  if (state.status === 'error') {
    return <StatusMessage onRetry={retry}>{t('common.loadError')}</StatusMessage>;
  }
  return <EditorView {...props} initial={state.data} />;
}

function EditorView({
  kind,
  ownerId,
  satellite,
  exportHref,
  initial,
}: Props & { initial: AdminTerritory }) {
  const { t, i18n } = useTranslation();
  const basePath = `/territories/${kind}/${ownerId}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);

  const [territory, setTerritory] = useState(initial);
  const [history, setHistory] = useState<History<EditableShape>>(() =>
    createHistory(shapeOf(initial)),
  );
  // Refs let map event handlers, set up once, see the latest values.
  const historyRef = useRef(history);
  historyRef.current = history;

  const [savedJson, setSavedJson] = useState(() => JSON.stringify(shapeOf(initial)));
  const [mode, setMode] = useState<Mode>('select');
  const [base, setBase] = useState<'street' | 'satellite'>('street');
  const [message, setMessage] = useState<Message | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hoveredNeighbor, setHoveredNeighbor] = useState<string | null>(null);
  const [pendingOverlaps, setPendingOverlaps] = useState<OverlapReport[] | null>(null);
  const [versions, setVersions] = useState<TerritoryVersionSummary[]>([]);
  const [confidence, setConfidence] = useState<Confidence>(initial.confidence);
  const [notes, setNotes] = useState(initial.notes);
  const [sourceNotes, setSourceNotes] = useState(initial.sourceNotes);

  const isDirty = JSON.stringify(history.present) !== savedJson;

  const snapRings = useMemo(
    () =>
      prepareSnapRings(
        [...initial.neighbors.map((n) => n.geometry), ...(initial.outline ? [initial.outline] : [])]
          .flatMap((geometry) => geometry.coordinates)
          .flat(),
      ),
    [initial.neighbors, initial.outline],
  );

  /** Puts a shape on the map. Returns false if any part couldn't be loaded. */
  const showShape = useCallback((shape: EditableShape) => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return true;

    draw.setMode('select');
    setMode('select');
    draw.clear();
    const results = draw.addFeatures(
      shape.parts.map((ring): GeoJSONStoreFeatures => ({
        type: 'Feature',
        properties: { mode: 'polygon' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })),
    );
    (map.getSource('holes') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: shape.holes.map((hole) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [hole] },
        properties: {},
      })),
    });
    return results.every((result) => result.valid);
  }, []);

  const showChecks = useCallback((checks: TerritoryChecks) => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource('overlaps') as GeoJSONSource | undefined)?.setData(
      collection(checks.overlaps.map((overlap) => overlap.geometry)),
    );
    (map.getSource('outside') as GeoJSONSource | undefined)?.setData(collection([checks.outside]));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STREET_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      if (satellite) {
        map.addSource('satellite', {
          type: 'raster',
          tiles: [satellite.tileUrl],
          tileSize: 256,
          attribution: satellite.attribution,
        });
        map.addLayer({
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
          layout: { visibility: 'none' },
        });
      }

      const neighbors: FeatureCollection = {
        type: 'FeatureCollection',
        features: initial.neighbors.map((neighbor) => ({
          type: 'Feature',
          geometry: neighbor.geometry,
          properties: { name: neighbor.name },
        })),
      };
      map.addSource('neighbors', { type: 'geojson', data: neighbors });
      map.addSource('outline', { type: 'geojson', data: collection([initial.outline]) });
      map.addSource('overlaps', { type: 'geojson', data: collection([]) });
      map.addSource('outside', { type: 'geojson', data: collection([]) });
      map.addSource('holes', { type: 'geojson', data: collection([]) });

      map.addLayer({
        id: 'neighbor-fill',
        type: 'fill',
        source: 'neighbors',
        paint: { 'fill-color': '#6b7c88', 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: 'neighbor-line',
        type: 'line',
        source: 'neighbors',
        paint: { 'line-color': '#4a5a65', 'line-width': 1.5 },
      });
      map.addLayer({
        id: 'outline-line',
        type: 'line',
        source: 'outline',
        paint: { 'line-color': '#37474f', 'line-width': 2, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: 'overlaps-fill',
        type: 'fill',
        source: 'overlaps',
        paint: { 'fill-color': '#e8590c', 'fill-opacity': 0.55 },
      });
      map.addLayer({
        id: 'outside-fill',
        type: 'fill',
        source: 'outside',
        paint: { 'fill-color': '#c92a2a', 'fill-opacity': 0.5 },
      });
      map.addLayer({
        id: 'holes-line',
        type: 'line',
        source: 'holes',
        paint: { 'line-color': '#c2255c', 'line-width': 2, 'line-dasharray': [1, 1] },
      });

      map.on('mousemove', 'neighbor-fill', (event) => {
        setHoveredNeighbor((event.features?.[0]?.properties?.name as string | undefined) ?? null);
      });
      map.on('mouseleave', 'neighbor-fill', () => setHoveredNeighbor(null));

      const snapToNeighbors: SnapToCustom = (event, context) =>
        findSnapPoint({ x: event.containerX, y: event.containerY }, snapRings, {
          project: context.project,
          unproject: context.unproject,
        });
      const snapping = { toCustom: snapToNeighbors, toCoordinate: true };

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 6 }),
        modes: [
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  // Moving a whole parish by accident would be easy to miss.
                  draggable: false,
                  coordinates: {
                    draggable: true,
                    midpoints: true,
                    deletable: true,
                    snappable: snapping,
                  },
                },
              },
            },
          }),
          new TerraDrawPolygonMode({ snapping }),
        ],
      });
      draw.start();
      drawRef.current = draw;

      draw.on('finish', (_id, context) => {
        // The library must finish its own work before the mode can change.
        if (context.mode === 'polygon') {
          setTimeout(() => {
            draw.setMode('select');
            setMode('select');
          }, 0);
        }
        const parts = draw
          .getSnapshot()
          .filter((f) => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing)
          .map((f) => (f.geometry.coordinates as Position[][])[0]!);
        const next = { parts, holes: historyRef.current.present.holes };
        setHistory(pushHistory(historyRef.current, next));
        setMessage(null);
      });

      const shape = historyRef.current.present;
      if (!showShape(shape)) setLoadFailed(true);
      showChecks(initial.checks);

      const bounds = boundsOf(
        initial.draft || initial.published
          ? [(initial.draft ?? initial.published)!]
          : initial.outline
            ? [initial.outline]
            : initial.neighbors.map((neighbor) => neighbor.geometry),
      );
      if (bounds) map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 16 });

      if (import.meta.env.DEV) {
        const debug = window as unknown as { __adminMap?: MapLibreMap; __adminDraw?: TerraDraw };
        debug.__adminMap = map;
        debug.__adminDraw = draw;
      }
      setIsReady(true);
    });

    return () => {
      setIsReady(false);
      drawRef.current?.stop();
      drawRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Set up once for each parish. Later changes go through showShape and showChecks.
  }, []);

  const loadVersions = useCallback(() => {
    adminRequest<TerritoryVersionSummary[]>(`${basePath}/versions`)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [basePath]);

  useEffect(loadVersions, [loadVersions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || !satellite) return;
    map.setLayoutProperty('satellite', 'visibility', base === 'satellite' ? 'visible' : 'none');
  }, [base, isReady, satellite]);

  // Warns before leaving with unsaved work, by link, browser back, or closing the tab.
  const blocker = useBlocker(isDirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(t('admin.editor.unsaved'))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const showError = useCallback(
    (error: unknown) => {
      const body: ApiErrorBody = error instanceof AdminApiError ? error.body : { error: 'generic' };
      if (error instanceof AdminApiError && error.status === 401) {
        setMessage({ type: 'error', text: t('admin.errors.session') });
        return;
      }
      setIssues(body.issues ?? []);
      setMessage({
        type: 'error',
        text: t(`admin.errors.${body.error}`, t('admin.errors.generic')),
      });
    },
    [t],
  );

  /** Runs a server action, and takes the shape it returns as the saved state. */
  const applyTerritory = useCallback(
    (next: AdminTerritory, replaceShape: boolean) => {
      setTerritory(next);
      showChecks(next.checks);
      loadVersions();
      if (replaceShape) {
        const shape = shapeOf(next);
        if (!showShape(shape)) setLoadFailed(true);
        setHistory(createHistory(shape));
        setSavedJson(JSON.stringify(shape));
      }
    },
    [loadVersions, showChecks, showShape],
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setIssues([]);
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const startDrawing = () => {
    drawRef.current?.setMode('polygon');
    setMode('polygon');
  };

  const startEditing = () => {
    drawRef.current?.setMode('select');
    setMode('select');
  };

  const deleteSelected = () => {
    const draw = drawRef.current;
    if (!draw) return;
    const selected = draw
      .getSnapshot()
      .find((f) => f.geometry.type === 'Polygon' && f.properties.selected);
    if (!selected?.id) {
      setMessage({ type: 'warning', text: t('admin.editor.selectPartFirst') });
      return;
    }
    draw.deselectFeature(selected.id);
    draw.removeFeatures([selected.id]);
    const parts = draw
      .getSnapshot()
      .filter((f) => f.geometry.type === 'Polygon')
      .map((f) => (f.geometry.coordinates as Position[][])[0]!);
    setHistory(pushHistory(history, { parts, holes: history.present.holes }));
  };

  const undo = () => {
    const next = undoHistory(history);
    showShape(next.present);
    setHistory(next);
  };

  const redo = () => {
    const next = redoHistory(history);
    showShape(next.present);
    setHistory(next);
  };

  const save = () =>
    run(async () => {
      if (history.present.parts.length === 0) {
        setMessage({ type: 'warning', text: t('admin.editor.emptyShape') });
        return;
      }
      const { geometry, droppedHoles } = joinHoles(history.present);
      const next = await adminRequest<AdminTerritory>(`${basePath}/draft`, {
        method: 'PUT',
        body: { geometry },
      });
      applyTerritory(next, true);
      setMessage(
        droppedHoles > 0
          ? { type: 'warning', text: t('admin.editor.droppedHoles', { count: droppedHoles }) }
          : { type: 'success', text: t('admin.editor.saved') },
      );
    });

  const trim = () =>
    run(async () => {
      if (history.present.parts.length === 0) {
        setMessage({ type: 'warning', text: t('admin.editor.emptyShape') });
        return;
      }
      const { geometry } = joinHoles(history.present);
      const result = await adminRequest<{ geometry: MultiPolygon }>(`${basePath}/trim`, {
        body: { geometry },
      });
      const shape = splitHoles(result.geometry);
      showShape(shape);
      setHistory(pushHistory(history, shape));
      showChecks(
        await adminRequest<TerritoryChecks>(`${basePath}/check`, {
          body: { geometry: result.geometry },
        }),
      );
      setMessage({ type: 'success', text: t('admin.editor.trimmed') });
    });

  const publish = (confirmOverlaps: boolean) =>
    run(async () => {
      setPendingOverlaps(null);
      try {
        const next = await adminRequest<AdminTerritory>(`${basePath}/publish`, {
          body: { confirmOverlaps },
        });
        applyTerritory(next, false);
        setMessage({ type: 'success', text: t('admin.editor.published') });
      } catch (error) {
        if (error instanceof AdminApiError && error.body.error === 'overlaps-need-confirmation') {
          setPendingOverlaps(error.body.overlaps ?? []);
          return;
        }
        throw error;
      }
    });

  const unpublish = () =>
    run(async () => {
      applyTerritory(
        await adminRequest<AdminTerritory>(`${basePath}/unpublish`, { body: {} }),
        false,
      );
      setMessage({ type: 'success', text: t('admin.editor.unpublished') });
    });

  const saveMeta = () =>
    run(async () => {
      const next = await adminRequest<AdminTerritory>(basePath, {
        method: 'PATCH',
        body: { confidence, notes, sourceNotes },
      });
      setTerritory(next);
      setMessage({ type: 'success', text: t('admin.meta.saved') });
    });

  const confirmDiscard = () => !isDirty || window.confirm(t('admin.editor.unsaved'));

  const restore = (versionId: number) => {
    if (!confirmDiscard()) return;
    void run(async () => {
      applyTerritory(
        await adminRequest<AdminTerritory>(`${basePath}/versions/${versionId}/restore`, {
          body: {},
        }),
        true,
      );
      setMessage({ type: 'success', text: t('admin.history.restored') });
    });
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !confirmDiscard()) return;
    void run(async () => {
      let geojson: unknown;
      try {
        geojson = JSON.parse(await file.text());
      } catch {
        setMessage({ type: 'error', text: t('admin.files.invalidFile') });
        return;
      }
      applyTerritory(
        await adminRequest<AdminTerritory>(`${basePath}/import`, { body: { geojson } }),
        true,
      );
      setMessage({ type: 'success', text: t('admin.files.imported') });
    });
  };

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  const hasUnpublishedChanges =
    territory.draft && JSON.stringify(territory.draft) !== JSON.stringify(territory.published);
  const statusText = territory.published
    ? hasUnpublishedChanges
      ? t('admin.editor.status.changes')
      : t('admin.editor.status.published', { date: formatDate(territory.publishedAt!) })
    : territory.draft
      ? t('admin.editor.status.draft')
      : t('admin.editor.status.none');

  const { overlaps, outside } = territory.checks;
  const canEdit = isReady && !busy;

  return (
    <div className="editor">
      <div className="editor-map-pane">
        <div className="editor-toolbar" role="toolbar">
          <button
            type="button"
            className="button"
            aria-pressed={mode === 'polygon'}
            disabled={!canEdit}
            onClick={startDrawing}
          >
            {t('admin.editor.draw')}
          </button>
          <button
            type="button"
            className="button"
            aria-pressed={mode === 'select'}
            disabled={!canEdit}
            onClick={startEditing}
          >
            {t('admin.editor.edit')}
          </button>
          <button type="button" className="button" disabled={!canEdit} onClick={deleteSelected}>
            {t('admin.editor.deletePart')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!canEdit || history.past.length === 0}
            onClick={undo}
          >
            {t('admin.editor.undo')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!canEdit || history.future.length === 0}
            onClick={redo}
          >
            {t('admin.editor.redo')}
          </button>
          {kind === 'parish' && (
            <button
              type="button"
              className="button"
              disabled={!canEdit}
              onClick={() => void trim()}
            >
              {t('admin.editor.trim')}
            </button>
          )}
          {satellite ? (
            <button
              type="button"
              className="button"
              aria-pressed={base === 'satellite'}
              onClick={() => setBase(base === 'street' ? 'satellite' : 'street')}
            >
              {t(base === 'street' ? 'admin.editor.satellite' : 'admin.editor.street')}
            </button>
          ) : (
            <span className="editor-hint">{t('admin.editor.noSatellite')}</span>
          )}
        </div>
        <p className="editor-hint" role="status">
          {hoveredNeighbor
            ? t('admin.editor.neighbor', { name: hoveredNeighbor })
            : t(mode === 'polygon' ? 'admin.editor.drawing' : 'admin.editor.editHelp')}
        </p>
        <div ref={containerRef} className="editor-map" />
      </div>

      <aside className="editor-side">
        <p className="editor-status" data-testid="editor-status">
          {statusText}
        </p>

        {message && (
          <p className={`message message-${message.type}`} role="status">
            {message.text}
          </p>
        )}
        {issues.map((issue) => (
          <p className="message message-error" key={issue} role="alert">
            {t(`admin.issues.${issue}`, issue)}
          </p>
        ))}
        {loadFailed && (
          <p className="message message-error" role="alert">
            {t('admin.editor.loadFailed')}
          </p>
        )}
        {history.present.holes.length > 0 && (
          <p className="message message-warning">
            {t('admin.editor.holes', { count: history.present.holes.length })}
          </p>
        )}

        <div className="button-row">
          <button
            type="button"
            className="button button-primary"
            disabled={!canEdit || !isDirty || loadFailed}
            onClick={() => void save()}
          >
            {t('admin.editor.save')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!canEdit || isDirty || !hasUnpublishedChanges}
            title={isDirty ? t('admin.editor.saveFirst') : undefined}
            onClick={() => void publish(false)}
          >
            {t('admin.editor.publish')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!canEdit || !territory.published}
            onClick={() => void unpublish()}
          >
            {t('admin.editor.unpublish')}
          </button>
        </div>

        {pendingOverlaps && (
          <div className="message message-warning" role="alertdialog">
            <p>{t('admin.checks.confirmTitle')}</p>
            <ul>
              {pendingOverlaps.map((overlap) => (
                <li key={overlap.id}>{overlap.name}</li>
              ))}
            </ul>
            <div className="button-row">
              <button type="button" className="button" onClick={() => void publish(true)}>
                {t('admin.checks.confirm')}
              </button>
              <button type="button" className="button" onClick={() => setPendingOverlaps(null)}>
                {t('admin.checks.cancel')}
              </button>
            </div>
          </div>
        )}

        {kind === 'parish' && (
          <section>
            <h2>{t('admin.checks.title')}</h2>
            {overlaps.length === 0 && !outside && <p>{t('admin.checks.ok')}</p>}
            {overlaps.map((overlap) => (
              <p className="message message-warning" key={overlap.id}>
                {t('admin.checks.overlap', {
                  name: overlap.name,
                  area: Math.round(overlap.areaM2).toLocaleString(i18n.language),
                })}
              </p>
            ))}
            {outside && <p className="message message-warning">{t('admin.checks.outside')}</p>}
          </section>
        )}

        <section>
          <h2>{t('admin.meta.title')}</h2>
          <label className="admin-field">
            <span>{t('admin.meta.confidence')}</span>
            <select
              value={confidence}
              onChange={(event) => setConfidence(event.target.value as Confidence)}
            >
              <option value="APPROXIMATE">{t('admin.meta.APPROXIMATE')}</option>
              <option value="CONFIRMED">{t('admin.meta.CONFIRMED')}</option>
            </select>
          </label>
          <label className="admin-field">
            <span>{t('admin.meta.sourceNotes')}</span>
            <textarea
              rows={3}
              value={sourceNotes}
              onChange={(event) => setSourceNotes(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>{t('admin.meta.notes')}</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button type="button" className="button" disabled={busy} onClick={() => void saveMeta()}>
            {t('admin.meta.save')}
          </button>
        </section>

        <section>
          <h2>{t('admin.files.title')}</h2>
          <div className="button-row">
            <label className="button">
              {t('admin.files.import')}
              <input
                type="file"
                className="visually-hidden"
                accept=".geojson,.json,application/geo+json,application/json"
                onChange={importFile}
              />
            </label>
            {exportHref && (
              <a className="button" href={exportHref} download>
                {t('admin.files.export')}
              </a>
            )}
          </div>
        </section>

        <section>
          <h2>{t('admin.history.title')}</h2>
          {versions.length === 0 && <p>{t('admin.history.empty')}</p>}
          <ul className="version-list">
            {versions.map((version) => (
              <li key={version.id}>
                <span>
                  {t(`admin.history.${version.action}`)} · {formatDate(version.createdAt)}
                </span>
                <button
                  type="button"
                  className="button button-small"
                  disabled={busy}
                  onClick={() => restore(version.id)}
                >
                  {t('admin.history.restore')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
