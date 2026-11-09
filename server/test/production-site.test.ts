import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTestDatabase } from './helpers/test-db';

describe('serving the built website', () => {
  let db: ReturnType<typeof createTestDatabase>;
  let webRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = createTestDatabase();
    webRoot = mkdtempSync(join(tmpdir(), 'parishmap-web-'));
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'index.html'), '<title>INDEX</title>');
    writeFileSync(join(webRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');
    app = createApp(db.prisma, {
      webRoot,
      https: true,
      admin: {
        satellite: { tileUrl: 'https://img.example:8443/{z}/{x}/{y}?key=K', attribution: '' },
      },
    });
  });

  afterAll(async () => {
    await db.cleanup();
    rmSync(webRoot, { recursive: true, force: true });
  });

  it('serves the website for its pages, including shared parish links', async () => {
    for (const path of ['/', '/guayaquil', '/guayaquil/san-agustin', '/admin/guayaquil']) {
      const res = await request(app).get(path).expect(200);
      expect(res.text).toContain('INDEX');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('asks search engines to skip only the admin pages', async () => {
    expect((await request(app).get('/admin')).headers['x-robots-tag']).toBe('noindex');
    expect((await request(app).get('/admin/guayaquil')).headers['x-robots-tag']).toBe('noindex');
    expect((await request(app).get('/guayaquil')).headers['x-robots-tag']).toBeUndefined();
    expect((await request(app).get('/administrador')).headers['x-robots-tag']).toBeUndefined();
  });

  it('caches hashed assets for a long time', async () => {
    const res = await request(app).get('/assets/app-abc123.js').expect(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('returns 404 for a missing asset, rather than the website page', async () => {
    const res = await request(app).get('/assets/missing.js').expect(404);
    expect(res.text).not.toContain('INDEX');
  });

  it('returns 404 for any other missing file, rather than the website page', async () => {
    const res = await request(app).get('/maplibre-gl-worker.mjs?v=1').expect(404);
    expect(res.text).not.toContain('INDEX');
    await request(app).get('/favicon.svg').expect(200);
  });

  it('keeps API errors as JSON, rather than the website page', async () => {
    const res = await request(app).get('/api/unknown').expect(404);
    expect(res.body).toEqual({ error: 'not-found' });
  });

  it('allows only the map providers in its security policy', async () => {
    const csp = (await request(app).get('/')).headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain('https://tiles.openfreemap.org');
    expect(csp).toMatch(/connect-src[^;]*https:\/\/photon\.komoot\.io/);
    expect(csp).toContain('https://img.example:8443');
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('key=K');
  });

  it('only sends HTTPS-only headers when serving over HTTPS', async () => {
    expect((await request(app).get('/')).headers['strict-transport-security']).toBeDefined();

    const plain = createApp(db.prisma, { webRoot, https: false });
    const res = await request(plain).get('/');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });

  it('stops at startup if the website has not been built', () => {
    expect(() => createApp(db.prisma, { webRoot: join(webRoot, 'nowhere') })).toThrow(
      "website isn't built",
    );
  });
});
