/**
 * Prints the settings for the admin account, to paste into server/.env.
 * The password is typed at a prompt, so it stays out of the shell history.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import bcrypt from 'bcryptjs';

const MIN_PASSWORD_LENGTH = 12;

const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  const username = (await prompt.question('Admin username: ')).trim();
  const password = await prompt.question(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);

  if (!username) throw new Error('The username is empty.');
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error('The password is too short.');

  const hash = await bcrypt.hash(password, 12);
  console.log('\nAdd these lines to server/.env:\n');
  console.log(`ADMIN_USERNAME='${username}'`);
  // Single quotes stop the "$" characters in the hash from being treated as variables.
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
  console.log(`SESSION_SECRET='${randomBytes(48).toString('base64url')}'`);
} finally {
  prompt.close();
}
