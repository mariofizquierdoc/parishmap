import { createPrismaClient } from '../src/db';
import { seedGuayaquil } from '../src/seed';

const prisma = createPrismaClient();

try {
  const diocese = await seedGuayaquil(prisma);
  const vicariates = await prisma.vicariate.count({ where: { dioceseId: diocese.id } });
  console.log(`Seeded ${diocese.name} with ${vicariates} vicariates.`);
} finally {
  await prisma.$disconnect();
}
