import { expect, test, type Page } from '@playwright/test';
import { isHighlighted, mapCenter, parishButton, useBlankMapStyle, waitForMap } from './helpers';

/** Points from the sample shapes in server/scripts/e2e-prepare.ts. */
const IN_SAGRADA_FAMILIA = { longitude: -79.91, latitude: -2.19 };
const IN_SAN_AGUSTIN = { lng: -79.89, lat: -2.19 };
/** Inside the diocese, where Cristo Redentor has only a private draft. */
const UNMAPPED = { longitude: -79.85, latitude: -2.19 };
const OUTSIDE_DIOCESE = { longitude: -80.5, latitude: -2.5 };

function photonFeature(name: string, lng: number, lat: number, osmId: number) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { osm_type: 'N', osm_id: osmId, name, city: 'Guayaquil' },
  };
}

/** Address search never reaches the real service. Returns the URLs that were requested. */
async function mockPhoton(page: Page, respond: () => { status: number; json: unknown }) {
  const requests: string[] = [];
  await page.route('https://photon.komoot.io/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill(respond());
  });
  return requests;
}

async function openFinder(page: Page) {
  await page.goto('/guayaquil');
  await waitForMap(page);
  await page.getByRole('button', { name: 'Encuentra mi parroquia' }).click();
}

const resultText = (page: Page) => page.locator('.find-result');
const marker = (page: Page) => page.getByRole('img', { name: 'Ubicación buscada' });

test.beforeEach(async ({ page }) => {
  await useBlankMapStyle(page);
});

test('using my location finds and highlights my parish', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(IN_SAGRADA_FAMILIA);
  await openFinder(page);

  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(resultText(page)).toHaveText(/Tu parroquia es Sagrada Familia/);
  await expect(page).toHaveURL(/\/guayaquil\/sagrada-familia$/);
  await expect(page.getByRole('heading', { name: 'Sagrada Familia' })).toBeVisible();
  await expect(marker(page)).toBeVisible();

  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(true);
  const center = await mapCenter(page);
  expect(center.lng).toBeCloseTo(IN_SAGRADA_FAMILIA.longitude, 3);
  expect(center.lat).toBeCloseTo(IN_SAGRADA_FAMILIA.latitude, 3);

  // The location stays in the browser: it's not in the URL.
  expect(page.url()).not.toContain('-79.91');
});

test('searching an address finds the parish, from the keyboard', async ({ page }) => {
  const requests = await mockPhoton(page, () => ({
    status: 200,
    json: {
      type: 'FeatureCollection',
      features: [
        photonFeature('Malecón 2000', IN_SAN_AGUSTIN.lng, IN_SAN_AGUSTIN.lat, 1),
        photonFeature('Malecón del Salado', -79.91, -2.18, 2),
      ],
    },
  }));
  await openFinder(page);

  const input = page.getByRole('combobox', { name: 'O escribe tu dirección' });
  await input.fill('malecon');
  await expect(page.getByRole('option', { name: /Malecón 2000/ })).toBeVisible();
  expect(requests.at(-1)).toContain('bbox=');

  await input.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Malecón 2000/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('Enter');

  await expect(resultText(page)).toHaveText(/Tu parroquia es San Agustín/);
  await expect(page).toHaveURL(/\/guayaquil\/san-agustin$/);
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'san-agustin')).toBe(true);
});

test('a place with no published territory says so, without revealing drafts', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(UNMAPPED);
  await openFinder(page);

  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(resultText(page)).toHaveText(/Aún no tenemos el área/);
  await expect(page).toHaveURL(/\/guayaquil$/);
  await expect(marker(page)).toBeVisible();
  await expect(page.getByText('SECRET-E2E-NOTE')).toHaveCount(0);
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'cristo-redentor')).toBe(false);
});

test('a place outside the diocese says so', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(OUTSIDE_DIOCESE);
  await openFinder(page);

  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(resultText(page)).toHaveText(
    'Esta ubicación está fuera de Arquidiócesis de Guayaquil.Buscar otra dirección',
  );
});

test('refusing location access explains it, and the address search still works', async ({
  page,
  context,
}) => {
  await context.clearPermissions();
  await mockPhoton(page, () => ({
    status: 200,
    json: { features: [photonFeature('Malecón 2000', IN_SAN_AGUSTIN.lng, IN_SAN_AGUSTIN.lat, 1)] },
  }));
  await openFinder(page);

  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(page.getByRole('alert')).toContainText('No diste permiso');

  await page.getByRole('combobox', { name: 'O escribe tu dirección' }).fill('malecon');
  await page.getByRole('option', { name: /Malecón 2000/ }).click();
  await expect(resultText(page)).toHaveText(/Tu parroquia es San Agustín/);
});

test('an unavailable address search and an empty result are explained', async ({ page }) => {
  let status = 500;
  await mockPhoton(page, () => ({ status, json: { features: [] } }));
  await openFinder(page);

  const input = page.getByRole('combobox', { name: 'O escribe tu dirección' });
  await input.fill('malecon');
  await expect(
    page.getByText('La búsqueda de direcciones no está disponible ahora.'),
  ).toBeVisible();

  status = 200;
  await input.fill('zzzz');
  await expect(page.getByText('No se encontró esa dirección.', { exact: false })).toBeVisible();
});

test('choosing a parish by hand afterwards removes the pin and the result', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(IN_SAGRADA_FAMILIA);
  await openFinder(page);
  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(resultText(page)).toBeVisible();

  await parishButton(page, 'San Agustín').click();
  await expect(page).toHaveURL(/\/guayaquil\/san-agustin$/);
  await expect(marker(page)).toHaveCount(0);
  await expect(resultText(page)).toHaveCount(0);
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'san-agustin')).toBe(true);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(false);
});

test('captures a screenshot of a result for review', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(IN_SAGRADA_FAMILIA);
  await openFinder(page);
  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(resultText(page)).toBeVisible();
  await waitForMap(page);
  await page.screenshot({ path: testInfo.outputPath(`find-${testInfo.project.name}.png`) });
});
