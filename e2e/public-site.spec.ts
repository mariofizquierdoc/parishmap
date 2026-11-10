import { expect, test } from '@playwright/test';
import { clickMapAt, isHighlighted, parishButton, useBlankMapStyle, waitForMap } from './helpers';

test.beforeEach(async ({ page }) => {
  await useBlankMapStyle(page);
});

test('opens the only diocese and lists all its parishes', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/guayaquil$/);
  await expect(page.getByLabel('Diócesis')).toHaveValue('guayaquil');
  await expect(page.getByText('165 parroquias')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vicaría Vía a Daule' })).toBeVisible();
});

test('selecting a parish from the list highlights it and updates the URL', async ({ page }) => {
  await page.goto('/guayaquil');
  await waitForMap(page);

  await parishButton(page, 'San Agustín').click();
  await expect(page).toHaveURL(/\/guayaquil\/san-agustin$/);
  await expect(page.getByRole('heading', { name: 'San Agustín' })).toBeVisible();
  await expect(page.getByText('Límites aproximados')).toBeVisible();
  await expect(page.getByRole('link', { name: '04-555-0100' })).toHaveAttribute(
    'href',
    'tel:045550100',
  );

  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'san-agustin')).toBe(true);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(false);
  await expect(page).toHaveTitle(/San Agustín/);
});

test('selecting a parish on the map selects it in the list', async ({ page }) => {
  await page.goto('/guayaquil');
  await waitForMap(page);

  await clickMapAt(page, -79.91, -2.19);
  await expect(page).toHaveURL(/\/guayaquil\/sagrada-familia$/);
  await expect(page.getByRole('heading', { name: 'Sagrada Familia' })).toBeVisible();
  await expect(page.getByText('Límites confirmados')).toBeVisible();
  await expect(parishButton(page, 'Sagrada Familia')).toHaveAttribute('aria-current', 'true');
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(true);
});

test('changing selection moves the highlight, and closing clears it', async ({ page }) => {
  await page.goto('/guayaquil/san-agustin');
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'san-agustin')).toBe(true);

  await parishButton(page, 'Sagrada Familia').click();
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'san-agustin')).toBe(false);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(true);

  await page.getByRole('button', { name: 'Cerrar detalles' }).click();
  await expect(page).toHaveURL(/\/guayaquil$/);
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(false);
});

test('a shared link opens with the parish selected', async ({ page }) => {
  await page.goto('/guayaquil/sagrada-familia');
  await expect(page.getByRole('heading', { name: 'Sagrada Familia' })).toBeVisible();
  await waitForMap(page);
  await expect.poll(() => isHighlighted(page, 'sagrada-familia')).toBe(true);
});

test('browser back returns to the previous selection', async ({ page }) => {
  await page.goto('/guayaquil/san-agustin');
  await parishButton(page, 'Sagrada Familia').click();
  await expect(page.getByRole('heading', { name: 'Sagrada Familia' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'San Agustín' })).toBeVisible();
});

test('search ignores accents and shows an empty state', async ({ page }) => {
  await page.goto('/guayaquil');
  const search = page.getByRole('searchbox');

  await search.fill('agustin');
  await expect(parishButton(page, 'San Agustín')).toBeVisible();
  await expect(page.getByText('1 parroquia', { exact: true })).toBeVisible();

  await search.fill('zzzz');
  await expect(page.getByText('Ninguna parroquia coincide')).toBeVisible();
});

test('a parish with no published territory says so, even with a private draft', async ({
  page,
}) => {
  await page.goto('/guayaquil/cristo-redentor');
  await expect(page.getByRole('heading', { name: 'Cristo Redentor' })).toBeVisible();
  await expect(page.getByText('Área aún no disponible')).toBeVisible();
  await expect(page.getByText('SECRET-E2E-NOTE')).toHaveCount(0);
});

test('a church with no territory explains that', async ({ page }) => {
  await page.goto('/guayaquil/iglesia-rectoral-san-jose');
  await expect(page.getByText('no tiene un territorio parroquial propio')).toBeVisible();
});

test('unknown parish and diocese show a clear message', async ({ page }) => {
  await page.goto('/guayaquil/no-existe');
  await expect(page.getByText('No se encontró esta parroquia')).toBeVisible();

  await page.goto('/no-existe');
  await expect(page.getByText('Página no encontrada')).toBeVisible();
});

test('the list still works if the map style fails to load', async ({ page }) => {
  await page.unroute('https://tiles.openfreemap.org/**');
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());

  await page.goto('/guayaquil');
  await expect(page.getByRole('alert')).toContainText('No se pudo cargar el mapa');
  await parishButton(page, 'San Agustín').click();
  await expect(page.getByRole('heading', { name: 'San Agustín' })).toBeVisible();
});

test('an API failure offers a retry that recovers', async ({ page }) => {
  let fail = true;
  await page.route('**/api/dioceses/guayaquil/parishes', (route) =>
    fail ? route.fulfill({ status: 500, json: {} }) : route.continue(),
  );

  await page.goto('/guayaquil');
  await expect(page.getByText('No se pudo cargar la información')).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('165 parroquias')).toBeVisible();
});

test('the list works from the keyboard', async ({ page }) => {
  await page.goto('/guayaquil');
  const button = parishButton(page, 'San Agustín');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/guayaquil\/san-agustin$/);
});

test('the page does not scroll sideways, and the map stays visible', async ({ page }) => {
  await page.goto('/guayaquil/san-agustin');
  await waitForMap(page);

  const hasSidewaysScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasSidewaysScroll).toBe(false);

  await parishButton(page, 'Virgen del Soto').scrollIntoViewIfNeeded();
  await expect(page.locator('.map canvas')).toBeInViewport();
});

test('the details and the selected row are both visible for a parish far down the list', async ({
  page,
}) => {
  // Opening a shared link, which must not scroll the details out of view.
  await page.goto('/guayaquil/san-agustin');
  await expect(page.getByRole('heading', { name: 'San Agustín' })).toBeInViewport();
  await expect(parishButton(page, 'San Agustín')).toBeInViewport();

  // Selecting from the list, also far down it.
  await parishButton(page, 'Santo Tomás Moro').click();
  await expect(page.getByRole('heading', { name: 'Santo Tomás Moro' })).toBeInViewport();
  await expect(parishButton(page, 'Santo Tomás Moro')).toBeInViewport();
  await expect(page.locator('.map canvas')).toBeInViewport();
});

test('captures screenshots for review', async ({ page }, testInfo) => {
  await page.goto('/guayaquil/san-agustin');
  await waitForMap(page);
  await page.screenshot({ path: testInfo.outputPath(`public-${testInfo.project.name}.png`) });
});
