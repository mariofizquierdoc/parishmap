import { resolve } from 'node:path';
import { restoreBackup } from '../src/backup';
import { resolveDatabaseUrl } from '../src/database-url';

const backupFile = process.argv[2];
if (!backupFile) {
  console.error('Usage: npm run restore -w server -- <backup file>');
  process.exit(1);
}

const databaseFile = resolveDatabaseUrl().slice('file:'.length);
const { previous } = restoreBackup(resolve(process.cwd(), backupFile), databaseFile);

console.log(`Restored: ${databaseFile}`);
if (previous) console.log(`Previous database kept at: ${previous}`);
console.log('Run "npm run db:deploy -w server" in case the backup predates a schema change.');
