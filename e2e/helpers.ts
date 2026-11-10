import type { Page } from '@playwright/test';

/** Tests don't depend on a real tile provider. They use a blank map style instead. */
export async function useBlankMapStyle(page: Page) {
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
}

/** Waits until the map has loaded its parish shapes and stopped moving. */
export async function waitForMap(page: Page) {
  await page.waitForFunction(() => {
    const map = (
      window as never as {
        __parishMap?: { getSource(id: string): unknown; loaded(): boolean; isMoving(): boolean };
      }
    ).__parishMap;
    return Boolean(map?.getSource('parishes') && map.loaded() && !map.isMoving());
  });
}

export function isHighlighted(page: Page, slug: string) {
  return page.evaluate((id) => {
    const map = (
      window as never as { __parishMap: { getFeatureState(t: object): { selected?: boolean } } }
    ).__parishMap;
    return map.getFeatureState({ source: 'parishes', id }).selected === true;
  }, slug);
}

export function mapCenter(page: Page) {
  return page.evaluate(() => {
    const map = (window as never as { __parishMap: { getCenter(): { lng: number; lat: number } } })
      .__parishMap;
    const { lng, lat } = map.getCenter();
    return { lng, lat };
  });
}

/** Clicks the map at a geographic location, as a visitor would. */
export async function clickMapAt(page: Page, lng: number, lat: number) {
  const point = await page.evaluate(
    ([x, y]) => {
      const map = (
        window as never as {
          __parishMap: { project(c: [number, number]): { x: number; y: number } };
        }
      ).__parishMap;
      return map.project([x!, y!]);
    },
    [lng, lat],
  );
  await page.locator('.map canvas').click({ position: { x: point.x, y: point.y } });
}

export const parishButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: false }).filter({ hasText: name });
