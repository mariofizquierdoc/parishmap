import bcrypt from 'bcryptjs';
import type { AuthConfig } from '../../src/auth';

export const TEST_USERNAME = 'admin';
export const TEST_PASSWORD = 'correct-horse-battery';

export function createTestAuth(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    username: TEST_USERNAME,
    // A low cost keeps tests fast. Real hashes use a higher cost.
    passwordHash: bcrypt.hashSync(TEST_PASSWORD, 4),
    sessionSecret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
    secureCookies: false,
    ...overrides,
  };
}
