import { defineConfig, devices } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from './e2e/admin-credentials';

const PORT = 3201;

/**
 * Tests the built site as production serves it. Some failures only happen here, because of the
 * bundler and the security policy. Run through `npm run test:e2e:prod`, which builds first.
 */
export default defineConfig({
  testDir: './e2e-prod',
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'production', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run e2e:prepare -w server && npm exec -w server -- tsx src/index.ts',
    url: `http://localhost:${PORT}/api/health`,
    env: {
      NODE_ENV: 'production',
      // This test server uses plain HTTP. Secure cookies still work on localhost.
      HTTPS: 'false',
      DATABASE_URL: 'file:./data/e2e.db',
      PORT: String(PORT),
      ADMIN_USERNAME: E2E_ADMIN_USERNAME,
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(E2E_ADMIN_PASSWORD, 4),
      SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-e2e',
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
