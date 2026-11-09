import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup } from '../src/backup';
import { createPrismaClient } from '../src/db';

const defaultFolder = fileURLToPath(new URL('../../backups/', import.meta.url));
const folder = resolve(process.argv[2] ?? defaultFolder);

const prisma = createPrismaClient();
try {
  const { databaseFile, geojsonFiles } = await createBackup(prisma, folder);
  console.log(`Database: ${databaseFile}`);
  for (const file of geojsonFiles) console.log(`GeoJSON:  ${file}`);
  console.log('\nThese files are only on this machine. Copy them somewhere else too.');
} finally {
  await prisma.$disconnect();
}
