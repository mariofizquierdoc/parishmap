import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from './admin-credentials';

type MapDebug = {
  project(c: [number, number]): { x: number; y: number };
  loaded(): boolean;
  isMoving(): boolean;
  getCenter(): { lng: number; lat: number };
};
type DrawDebug = {
  getSnapshot(): {
    id: string;
    geometry: { type: string; coordinates: number[][][] };
    properties: { currentlyDrawing?: boolean };
  }[];
  selectFeature(id: string): void;
};
type Debug = { __adminMap?: MapDebug; __adminDraw?: DrawDebug };

// These tests change shared data and drive a mouse, so they run once, on the desktop layout.
test.skip(({ isMobile }) => isMobile, 'Admin flows run on the desktop layout');

async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Usuario').fill(E2E_ADMIN_USERNAME);
  await page.getByLabel('Contraseña').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

async function waitForEditor(page: Page) {
  await page.waitForFunction(() => {
    const { __adminMap: map, __adminDraw: draw } = window as unknown as Debug;
    return Boolean(map && draw && map.loaded() && !map.isMoving());
  });
}

async function openParish(page: Page, name: string) {
  await page.goto('/admin/guayaquil');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await waitForEditor(page);
}

/** Converts a map location to a position on the page. */
async function pagePoint(page: Page, lng: number, lat: number) {
  await waitForEditor(page);
  const point = await page.evaluate(
    ([a, b]) => (window as unknown as Debug).__adminMap!.project([a!, b!]),
    [lng, lat],
  );
  const box = (await page.locator('.editor-map canvas').first().boundingBox())!;
  return { x: box.x + point.x, y: box.y + point.y };
}

async function clickMap(page: Page, lng: number, lat: number) {
  const { x, y } = await pagePoint(page, lng, lat);
  await page.mouse.move(x, y);
  await page.waitForTimeout(60);
  await page.mouse.click(x, y);
  await page.waitForTimeout(100);
}

async function drawPolygon(page: Page, points: [number, number][]) {
  await page.getByRole('button', { name: 'Dibujar área' }).click();
  for (const [lng, lat] of points) await clickMap(page, lng, lat);
  await clickMap(page, points[0]![0], points[0]![1]);
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** Finished shapes currently on the editor's map. */
function editorRings(page: Page) {
  return page.evaluate(() =>
    (window as unknown as Debug)
      .__adminDraw!.getSnapshot()
      .filter((f) => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing)
      .map((f) => f.geometry.coordinates[0]!),
  );
}

async function territoryOf(page: Page, parishName: string) {
  const diocese = (await (await page.request.get('/api/admin/dioceses/guayaquil')).json()) as {
    parishes: { id: number; name: string }[];
  };
  const parish = diocese.parishes.find((item) => item.name === parishName)!;
  const response = await page.request.get(`/api/admin/territories/parish/${parish.id}`);
  return {
    id: parish.id,
    ...((await response.json()) as {
      draft: { coordinates: number[][][][] } | null;
      published: { coordinates: number[][][][] } | null;
    }),
  };
}

function box(west: number, south: number, east: number, north: number): [number, number][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
});

test('rejects a wrong password, and logs in and out', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Usuario').fill(E2E_ADMIN_USERNAME);
  await page.getByLabel('Contraseña').fill('wrong-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');

  await login(page);
  await expect(page.getByTestId('progress')).toContainText('publicadas');

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

test('filters and searches the parish list', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('button', { name: 'Todas (165)' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(165);

  await page.getByRole('button', { name: /^Confirmadas/ }).click();
  await expect(page.locator('tbody tr')).toContainText(['Sagrada Familia']);

  await page.getByRole('button', { name: /^Sin territorio/ }).click();
  await expect(
    page.getByRole('link', { name: 'Iglesia Rectoral San José', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Todas/ }).click();
  await page.getByRole('searchbox').fill('agustin');
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('full flow: draw, overlap warning, trim, publish, public view, edit, restore', async ({
  page,
}) => {
  await login(page);
  await openParish(page, 'San Alejo');
  await expect(page.getByTestId('editor-status')).toHaveText('Sin dibujar');

  // Nothing to save yet.
  await expect(page.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();

  // Overlaps San Agustín, whose east edge is at -79.88.
  await drawPolygon(page, box(-79.885, -2.195, -79.87, -2.185));
  await expect.poll(() => editorRings(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('Borrador guardado')).toBeVisible();
  await expect(page.getByText(/Se solapa con San Agustín/)).toBeVisible();
  await expect(page.getByTestId('editor-status')).toHaveText('Borrador, sin publicar');

  // A draft stays off the public site.
  const beforePublish = await (
    await page.request.get('/api/dioceses/guayaquil/territories')
  ).text();
  expect(beforePublish).not.toContain('san-alejo');

  // Publishing with an overlap asks first, and cancelling publishes nothing.
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('San Agustín');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  expect((await territoryOf(page, 'San Alejo')).published).toBeNull();

  // Trimming removes the overlap and gives an exactly shared edge.
  await page.getByRole('button', { name: 'Recortar con vecinas' }).click();
  await expect(page.getByText('Área recortada')).toBeVisible();
  const trimmed = await editorRings(page);
  expect(Math.min(...trimmed[0]!.map(([lng]) => lng!))).toBe(-79.88);

  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('Sin solapamientos')).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Publicado en el sitio público')).toBeVisible();
  await expect(page.getByTestId('editor-status')).toContainText('Publicada:');

  // The public site shows it.
  const publicPage = await page.context().newPage();
  await publicPage.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
  await publicPage.goto('/guayaquil/san-alejo');
  await expect(publicPage.getByText('Límites aproximados')).toBeVisible();
  await publicPage.close();

  // Editing a vertex: the point lands where it's dropped, and the map doesn't pan with it.
  const firstPublished = (await territoryOf(page, 'San Alejo')).published;
  const easternmost = Math.max(...trimmed[0]!.map(([lng]) => lng!));
  const corner = trimmed[0]!.find(([lng]) => lng === easternmost);
  await waitForEditor(page);
  await page.evaluate(() => {
    const draw = (window as unknown as Debug).__adminDraw!;
    draw.selectFeature(draw.getSnapshot()[0]!.id);
  });
  await page.waitForTimeout(150);

  const centerBefore = await page.evaluate(() =>
    (window as unknown as Debug).__adminMap!.getCenter(),
  );
  const from = await pagePoint(page, corner![0]!, corner![1]!);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const centerAfter = await page.evaluate(() =>
    (window as unknown as Debug).__adminMap!.getCenter(),
  );
  expect(centerAfter).toEqual(centerBefore);
  const edited = await editorRings(page);
  expect(edited).not.toEqual(trimmed);

  // Undo and redo.
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect.poll(() => editorRings(page)).toEqual(trimmed);
  await expect(page.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  await page.getByRole('button', { name: 'Rehacer' }).click();
  await expect.poll(() => editorRings(page)).toEqual(edited);

  // Publishing is blocked until saved. A saved edit stays private until published.
  await expect(page.getByRole('button', { name: 'Publicar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('Borrador guardado')).toBeVisible();
  await expect(page.getByTestId('editor-status')).toHaveText('Publicada, con cambios sin publicar');
  expect((await territoryOf(page, 'San Alejo')).published).toEqual(firstPublished);

  // Restoring the published version brings back that shape as the draft.
  const publishRow = page.locator('.version-list li').filter({ hasText: 'Publicado' }).first();
  await publishRow.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Versión restaurada')).toBeVisible();
  await expect.poll(() => editorRings(page)).toEqual(trimmed);
  expect((await territoryOf(page, 'San Alejo')).draft).toEqual(firstPublished);

  // Unpublishing removes it from the public site but keeps the work.
  await page.getByRole('button', { name: 'Despublicar' }).click();
  await expect(page.getByText('Retirado del sitio público')).toBeVisible();
  const afterUnpublish = await (
    await page.request.get('/api/dioceses/guayaquil/territories')
  ).text();
  expect(afterUnpublish).not.toContain('san-alejo');
  expect((await territoryOf(page, 'San Alejo')).draft).toEqual(firstPublished);
});

test('a new point snaps exactly onto a neighbor’s corner', async ({ page }) => {
  await login(page);
  await openParish(page, 'San Gabriel de la Dolorosa');

  // Clicks a few pixels from San Agustín's corner at (-79.88, -2.18).
  const corner = await pagePoint(page, -79.88, -2.18);
  await page.getByRole('button', { name: 'Dibujar área' }).click();
  await page.mouse.move(corner.x + 5, corner.y - 4);
  await page.waitForTimeout(60);
  await page.mouse.click(corner.x + 5, corner.y - 4);
  await page.waitForTimeout(100);
  await clickMap(page, -79.87, -2.18);
  await clickMap(page, -79.87, -2.17);
  await page.mouse.move(corner.x + 5, corner.y - 4);
  await page.waitForTimeout(60);
  await page.mouse.click(corner.x + 5, corner.y - 4);

  await expect.poll(() => editorRings(page)).toHaveLength(1);
  const [ring] = await editorRings(page);
  expect(ring).toContainEqual([-79.88, -2.18]);
});

test('a shape with a hole keeps it through editing and saving', async ({ page }) => {
  await login(page);
  const { id } = await territoryOf(page, 'San Juan Bosco');
  const outer = [...box(-79.97, -2.25, -79.94, -2.22), [-79.97, -2.25]];
  const hole = [...box(-79.96, -2.24, -79.95, -2.23), [-79.96, -2.24]];
  const saved = await page.request.put(`/api/admin/territories/parish/${id}/draft`, {
    data: { geometry: { type: 'Polygon', coordinates: [outer, hole] } },
  });
  expect(saved.ok()).toBe(true);

  await openParish(page, 'San Juan Bosco');
  await expect(page.getByText('Esta área tiene 1 hueco')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Adds a separate part, then saves.
  await drawPolygon(page, box(-79.985, -2.25, -79.975, -2.24));
  await expect.poll(() => editorRings(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('Borrador guardado')).toBeVisible();

  const { draft } = await territoryOf(page, 'San Juan Bosco');
  expect(draft?.coordinates).toHaveLength(2);
  expect(draft?.coordinates[0]).toHaveLength(2);
  expect(draft?.coordinates[0]?.[1]).toEqual(hole);
});

test('deleting a part leaves the others, and an empty shape cannot be saved', async ({ page }) => {
  await login(page);
  await openParish(page, 'San Juan María Vianney');
  await drawPolygon(page, box(-79.975, -2.26, -79.965, -2.25));
  await expect.poll(() => editorRings(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Eliminar área seleccionada' }).click();
  await expect(page.getByText('Selecciona primero un área')).toBeVisible();

  await page.evaluate(() => {
    const draw = (window as unknown as Debug).__adminDraw!;
    draw.selectFeature(draw.getSnapshot()[0]!.id);
  });
  await page.getByRole('button', { name: 'Eliminar área seleccionada' }).click();
  await expect.poll(() => editorRings(page)).toHaveLength(0);

  // Undo brings it back.
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect.poll(() => editorRings(page)).toHaveLength(1);
});

test('warns before leaving with unsaved changes', async ({ page }) => {
  await login(page);
  await openParish(page, 'San Pablo Apóstol');
  await drawPolygon(page, box(-79.975, -2.15, -79.965, -2.14));

  let dialogs = 0;
  page.once('dialog', (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });
  await page.getByRole('link', { name: /Volver a la lista/ }).click();
  await expect(page.getByRole('heading', { name: 'San Pablo Apóstol', level: 1 })).toBeVisible();
  await expect.poll(() => dialogs).toBe(1);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('link', { name: /Volver a la lista/ }).click();
  await expect(page.getByTestId('progress')).toBeVisible();
});

test('imports a GeoJSON file as a draft, and rejects a bad one', async ({ page }) => {
  await login(page);
  await openParish(page, 'Santa Gema');
  const input = page.locator('input[type=file]');

  await input.setInputFiles({
    name: 'bad.geojson',
    mimeType: 'application/json',
    buffer: Buffer.from('not json'),
  });
  await expect(page.getByText('El archivo no es GeoJSON válido')).toBeVisible();

  await input.setInputFiles({
    name: 'point.geojson',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'Point', coordinates: [0, 0] })),
  });
  await expect(page.getByText('El área no es válida')).toBeVisible();

  const ring = [...box(-79.86, -2.26, -79.85, -2.25), [-79.86, -2.26]];
  await input.setInputFiles({
    name: 'area.geojson',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      }),
    ),
  });
  await expect(page.getByText('Archivo importado como borrador')).toBeVisible();
  await expect.poll(() => editorRings(page)).toEqual([ring]);
});

test('edits parish details, including a name correction that keeps the shared link', async ({
  page,
}) => {
  await login(page);
  await page.goto('/admin/guayaquil');
  await page.getByRole('link', { name: 'El Buatismo de Jesús', exact: true }).click();
  await expect(page.getByText('Texto original de la fuente')).toContainText('El Buatismo de Jesús');

  await page.getByLabel('Nombre').fill('El Bautismo de Jesús');
  await page.getByLabel('Teléfono').fill('04-555-0199');
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Datos guardados')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'El Bautismo de Jesús', level: 1 })).toBeVisible();

  await page.getByLabel(/^Sitio web/).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Revisa los datos ingresados')).toBeVisible();
  await page.getByLabel(/^Sitio web/).fill('');

  await page.goto('/guayaquil/el-buatismo-de-jesus');
  await expect(page.getByRole('heading', { name: 'El Bautismo de Jesús' })).toBeVisible();
  await expect(page.getByRole('link', { name: '04-555-0199' })).toBeVisible();
});

test('marking a church as having no territory removes the editor', async ({ page }) => {
  await login(page);
  await page.goto('/admin/guayaquil');
  await page.getByRole('link', { name: 'Santa María Reina del Carmen', exact: true }).click();
  await waitForEditor(page);

  await page.getByLabel(/Tiene territorio propio/).uncheck();
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('marcada como sin territorio')).toBeVisible();
  await expect(page.locator('.editor-map')).toHaveCount(0);
});

test('draws the diocese outline without parish checks', async ({ page }) => {
  await login(page);
  await page.goto('/admin/guayaquil/outline');
  await waitForEditor(page);
  await expect(page.getByRole('button', { name: 'Recortar con vecinas' })).toHaveCount(0);
  await expect.poll(() => editorRings(page)).toHaveLength(1);
});

test('captures screenshots for review', async ({ page }, testInfo) => {
  await login(page);
  await page.screenshot({ path: testInfo.outputPath('admin-list.png'), fullPage: false });
  await openParish(page, 'Sagrada Familia');
  await page.screenshot({ path: testInfo.outputPath('admin-editor.png'), fullPage: false });
});

test('the public site does not download the admin code', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (request) => scripts.push(request.url()));
  await page.goto('/guayaquil');
  await expect(page.getByText('165 parroquias')).toBeVisible();
  expect(scripts.filter((url) => /AdminApp|terra-draw|turf/i.test(url))).toEqual([]);
});
