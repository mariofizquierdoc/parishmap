import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createSessionToken, loadAuthConfig, SESSION_COOKIE } from '../src/auth';
import { createTestAuth, TEST_PASSWORD, TEST_USERNAME } from './helpers/auth';
import { createTestDatabase } from './helpers/test-db';

describe('admin login', () => {
  let db: ReturnType<typeof createTestDatabase>;
  const auth = createTestAuth();
  const newApp = (maxLoginAttempts = 1000) =>
    createApp(db.prisma, { auth, admin: { maxLoginAttempts } });

  const login = (app: ReturnType<typeof createApp>, password = TEST_PASSWORD) =>
    request(app).post('/api/admin/login').send({ username: TEST_USERNAME, password });

  const cookieWith = (token: string) => `${SESSION_COOKIE}=${token}`;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('logs in with correct credentials and sets a protected cookie', async () => {
    const res = await login(newApp()).expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('marks the cookie Secure when configured for production', async () => {
    const app = createApp(db.prisma, { auth: createTestAuth({ secureCookies: true }) });
    const res = await login(app).expect(200);
    expect(String(res.headers['set-cookie'])).toContain('Secure');
  });

  it('accepts its session on protected routes', async () => {
    const app = newApp();
    const agent = request.agent(app);
    await agent
      .post('/api/admin/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    await agent.get('/api/admin/me').expect(200);
  });

  it('rejects a wrong password or username with the same response', async () => {
    const app = newApp();
    const wrongPassword = await login(app, 'wrong').expect(401);
    const wrongUser = await request(app)
      .post('/api/admin/login')
      .send({ username: 'someone', password: TEST_PASSWORD })
      .expect(401);

    expect(wrongPassword.body).toEqual({ error: 'invalid-credentials' });
    expect(wrongUser.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('rejects malformed login requests', async () => {
    const app = newApp();
    await request(app).post('/api/admin/login').send({ username: 'admin' }).expect(400);
    await request(app)
      .post('/api/admin/login')
      .send({ username: { $ne: '' }, password: ['x'] })
      .expect(400);
    await request(app)
      .post('/api/admin/login')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);
  });

  it('rejects a missing session', async () => {
    await request(newApp()).get('/api/admin/me').expect(401);
  });

  it('protects unknown admin routes too, without revealing what exists', async () => {
    await request(newApp()).get('/api/admin/anything').expect(401);
    await request(newApp()).post('/api/admin/parishes').send({}).expect(401);
  });

  it('rejects an invalid session token', async () => {
    await request(newApp()).get('/api/admin/me').set('Cookie', cookieWith('garbage')).expect(401);
  });

  it('rejects an expired session', async () => {
    const expired = await createSessionToken(auth, -60);
    await request(newApp()).get('/api/admin/me').set('Cookie', cookieWith(expired)).expect(401);
  });

  it('accepts a token that expires later, proving the expiry test is meaningful', async () => {
    const valid = await createSessionToken(auth, 60);
    await request(newApp()).get('/api/admin/me').set('Cookie', cookieWith(valid)).expect(200);
  });

  it('rejects a token signed with a different secret', async () => {
    const other = createTestAuth({
      sessionSecret: new TextEncoder().encode('another-secret-another-secret-another-12'),
    });
    const token = await createSessionToken(other);
    await request(newApp()).get('/api/admin/me').set('Cookie', cookieWith(token)).expect(401);
  });

  it('rejects an unsigned token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: TEST_USERNAME, aud: 'parishmap-admin', exp: 9999999999 }),
    ).toString('base64url');
    await request(newApp())
      .get('/api/admin/me')
      .set('Cookie', cookieWith(`${header}.${payload}.`))
      .expect(401);
  });

  it('rejects a token for a different username', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('former-admin')
      .setAudience('parishmap-admin')
      .setExpirationTime('1h')
      .sign(auth.sessionSecret);
    await request(newApp()).get('/api/admin/me').set('Cookie', cookieWith(token)).expect(401);
  });

  it('logs out by clearing the cookie', async () => {
    const agent = request.agent(newApp());
    await agent
      .post('/api/admin/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    await agent.post('/api/admin/logout').expect(200);
    await agent.get('/api/admin/me').expect(401);
  });

  it('limits repeated failed logins, even with the right password afterward', async () => {
    const app = newApp(3);
    for (let i = 0; i < 3; i++) await login(app, 'wrong').expect(401);
    const blocked = await login(app).expect(429);
    expect(blocked.body).toEqual({ error: 'too-many-attempts' });
  });

  it('does not count successful logins toward the limit', async () => {
    const app = newApp(2);
    for (let i = 0; i < 4; i++) await login(app).expect(200);
  });

  it('keeps the admin site closed when login is not configured', async () => {
    const app = createApp(db.prisma);
    await request(app).get('/api/admin/me').expect(503);
    await login(app).expect(503);
  });

  it('keeps public routes open without a session', async () => {
    await request(newApp()).get('/api/dioceses').expect(200);
  });
});

describe('loadAuthConfig', () => {
  const hash = '$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234';
  const secret = 'x'.repeat(32);
  const complete = { ADMIN_USERNAME: 'a', ADMIN_PASSWORD_HASH: hash, SESSION_SECRET: secret };

  it('returns null when nothing is set outside production', () => {
    expect(loadAuthConfig({})).toBeNull();
  });

  it('refuses to start in production without settings', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow('required in production');
  });

  it('refuses partial settings', () => {
    expect(() => loadAuthConfig({ ADMIN_USERNAME: 'a' })).toThrow('Set all of');
  });

  it('refuses a short session secret', () => {
    expect(() => loadAuthConfig({ ...complete, SESSION_SECRET: 'short' })).toThrow('at least 32');
  });

  it('refuses a plain-text password', () => {
    expect(() => loadAuthConfig({ ...complete, ADMIN_PASSWORD_HASH: 'hunter2' })).toThrow(
      'bcrypt hash',
    );
  });

  it('uses secure cookies only in production', () => {
    expect(loadAuthConfig(complete)?.secureCookies).toBe(false);
    expect(loadAuthConfig({ ...complete, NODE_ENV: 'production' })?.secureCookies).toBe(true);
  });
});
