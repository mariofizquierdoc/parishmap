import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, useBlankMapStyle } from './helpers';

// Changes shared data, so it runs once, on the desktop layout, like the other admin tests.
test.skip(({ isMobile }) => isMobile, 'Admin flows run on the desktop layout');

const DIOCESE = 'Diócesis de Prueba E2E';
const PARISH = 'San Martín de Prueba';

async function confirmDelete(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Eliminar definitivamente' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Escribe «${name}» para confirmar`).fill(name);
  await confirm.click();
}

test('creates a diocese, a vicariate and a parish, then deletes them all', async ({ page }) => {
  await useBlankMapStyle(page);
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Diócesis', level: 1 })).toBeVisible();

  // Create a hidden diocese. The slug follows the name.
  await page.getByLabel('Nombre').fill(DIOCESE);
  await expect(page.getByLabel('Dirección web')).toHaveValue('diocesis-de-prueba-e2e');
  await page.getByRole('button', { name: 'Crear diócesis' }).click();
  await expect(
    page.getByRole('heading', { name: `Configuración de ${DIOCESE}`, level: 1 }),
  ).toBeVisible();

  // The public site doesn't know about it yet.
  const hidden = await page.request.get('/api/dioceses/diocesis-de-prueba-e2e');
  expect(hidden.status()).toBe(404);

  await page.getByLabel('Nueva vicaría').fill('Centro');
  await page.getByRole('button', { name: 'Añadir vicaría' }).click();
  await expect(page.getByText('Vicaría añadida.')).toBeVisible();

  // Add a parish from the diocese's parish list.
  await page.getByRole('link', { name: 'Volver a las parroquias' }).click();
  await expect(page.getByText('Esta diócesis está oculta')).toBeVisible();
  await page.getByRole('link', { name: 'Nueva parroquia' }).click();
  await page.getByLabel('Nombre').fill(PARISH);
  await page.getByRole('button', { name: 'Crear parroquia' }).click();
  await expect(page.getByRole('heading', { name: PARISH, level: 1 })).toBeVisible();

  // A diocese with parishes can't be deleted.
  await page.goto('/admin/diocesis-de-prueba-e2e/settings');
  await expect(page.getByRole('button', { name: 'Eliminar diócesis' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Eliminar Centro' })).toBeDisabled();

  // Delete the parish.
  await page.goto('/admin/diocesis-de-prueba-e2e');
  await page.getByRole('link', { name: PARISH, exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar parroquia' }).click();
  await confirmDelete(page, PARISH);
  await expect(page.getByRole('heading', { name: DIOCESE, level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: PARISH, exact: true })).toHaveCount(0);

  // Then the vicariate, and finally the diocese.
  // The hidden-diocese warning links there too.
  await page.getByRole('link', { name: 'Configuración de la diócesis' }).first().click();
  await page.getByRole('button', { name: 'Eliminar Centro' }).click();
  await expect(page.getByText('Vicaría eliminada.')).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar diócesis' }).click();
  await confirmDelete(page, DIOCESE);

  await expect(page.getByRole('heading', { name: 'Diócesis', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: DIOCESE })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Arquidiócesis de Guayaquil' })).toBeVisible();
});
