import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from '../e2e/admin-credentials';

/** Collects anything the browser reports as broken, including security policy violations. */
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    // The login check answers 401 before signing in, which is expected.
    if (message.type() === 'error' && !message.text().includes('401')) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
});

test('the map worker loads as JavaScript', async ({ page }) => {
  const problems = collectProblems(page);
  const worker = page.waitForResponse((response) => /maplibre-gl-worker/.test(response.url()));

  await page.goto('/guayaquil/san-agustin');
  const response = await worker;

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('javascript');
  await expect(page.getByText('Límites aproximados')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(problems).toEqual([]);
});

test('the selected parish is really drawn on the map', async ({ page }) => {
  await page.goto('/guayaquil/san-agustin');
  await expect(page.locator('.map canvas')).toBeVisible();

  // Waits for the highlight color to appear, which needs the worker to have processed the shape.
  await expect
    .poll(
      async () => {
        const png = await page.locator('.map canvas').screenshot();
        return page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const [r, , b] = context.getImageData(image.width / 2, image.height / 2, 1, 1).data;
          // The orange highlight has far more red than blue. The blank map doesn't.
          return r! - b! > 40;
        }, png.toString('base64'));
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test('shared links open the page, and missing files return a real 404', async ({
  page,
  request,
}) => {
  await page.goto('/guayaquil/sagrada-familia');
  await expect(page.getByRole('heading', { name: 'Sagrada Familia' })).toBeVisible();

  for (const path of ['/missing-file.mjs', '/assets/missing.js', '/api/unknown']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});

test('the admin site works under the security policy, and its login cookie is protected', async ({
  page,
  context,
}) => {
  const problems = collectProblems(page);

  await page.goto('/admin');
  await page.getByLabel('Usuario').fill(E2E_ADMIN_USERNAME);
  await page.getByLabel('Contraseña').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('progress')).toBeVisible();

  const cookie = (await context.cookies()).find((item) => item.name === 'parishmap_session');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });

  await page.getByRole('link', { name: 'Sagrada Familia', exact: true }).click();
  await expect(page.locator('.editor-map canvas').first()).toBeVisible();
  await expect(page.getByTestId('editor-status')).toContainText('Publicada');
  await expect(page.getByRole('button', { name: 'Dibujar área' })).toBeEnabled();

  expect(problems).toEqual([]);
});

test('debug hooks are not exposed', async ({ page }) => {
  await page.goto('/guayaquil');
  await expect(page.locator('.map canvas')).toBeVisible();
  expect(await page.evaluate(() => '__parishMap' in window)).toBe(false);
});
