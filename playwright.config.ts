import { defineConfig, devices } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from './e2e/admin-credentials';

const API_PORT = 3101;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Uses its own database and ports, so tests never touch development data.
      command: 'npm run e2e:prepare -w server && npm exec -w server -- tsx src/index.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        DATABASE_URL: 'file:./data/e2e.db',
        PORT: String(API_PORT),
        ADMIN_USERNAME: E2E_ADMIN_USERNAME,
        ADMIN_PASSWORD_HASH: bcrypt.hashSync(E2E_ADMIN_PASSWORD, 4),
        SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-e2e',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -w web -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
