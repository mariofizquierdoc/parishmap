-- CreateTable
CREATE TABLE "Diocese" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Vicariate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dioceseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Vicariate_dioceseId_fkey" FOREIGN KEY ("dioceseId") REFERENCES "Diocese" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Parish" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dioceseId" INTEGER NOT NULL,
    "vicariateId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceName" TEXT,
    "hasTerritory" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "priest" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Parish_dioceseId_fkey" FOREIGN KEY ("dioceseId") REFERENCES "Diocese" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Parish_vicariateId_fkey" FOREIGN KEY ("vicariateId") REFERENCES "Vicariate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dioceseId" INTEGER,
    "parishId" INTEGER,
    "draftGeojson" TEXT,
    "publishedGeojson" TEXT,
    "publishedBbox" TEXT,
    "publishedAt" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'APPROXIMATE',
    "notes" TEXT,
    "sourceNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Territory_dioceseId_fkey" FOREIGN KEY ("dioceseId") REFERENCES "Diocese" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Territory_parishId_fkey" FOREIGN KEY ("parishId") REFERENCES "Parish" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TerritoryVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "territoryId" INTEGER NOT NULL,
    "geojson" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TerritoryVersion_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Diocese_slug_key" ON "Diocese"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Vicariate_dioceseId_name_key" ON "Vicariate"("dioceseId", "name");

-- CreateIndex
CREATE INDEX "Parish_dioceseId_idx" ON "Parish"("dioceseId");

-- CreateIndex
CREATE UNIQUE INDEX "Parish_dioceseId_slug_key" ON "Parish"("dioceseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Parish_vicariateId_sourceName_key" ON "Parish"("vicariateId", "sourceName");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_dioceseId_key" ON "Territory"("dioceseId");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_parishId_key" ON "Territory"("parishId");

-- CreateIndex
CREATE INDEX "TerritoryVersion_territoryId_createdAt_idx" ON "TerritoryVersion"("territoryId", "createdAt");
