-- AlterTable
ALTER TABLE "Diocese" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- Dioceses that existed before this column was added were already public.
UPDATE "Diocese" SET "isPublished" = true;
