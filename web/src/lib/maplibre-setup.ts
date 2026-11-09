import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre looks for its worker beside its own code, but the production build merges that code
// into another file and doesn't include the worker. Without this, shapes never draw in
// production, although everything works in development. See e2e-prod/.
setWorkerUrl(workerUrl);
