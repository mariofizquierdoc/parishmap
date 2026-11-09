import {
  bboxOf,
  findCoverageGaps,
  findOutsideDiocese,
  findOverlaps,
  normalize,
  parseAreaGeometry,
  trimToNeighbors,
  validate,
  type ValidationIssue,
} from '@parishmap/shared/geometry';
import type {
  AdminProgress,
  AdminTerritory,
  OverlapReport,
  TerritoryChecks,
  TerritoryOwnerKind,
} from '@parishmap/shared/admin';
import type { Confidence } from '@parishmap/shared';
import type { MultiPolygon } from 'geojson';
import type { VersionAction } from './domain';
import type { PrismaClient } from './generated/prisma/client';

/** Far beyond any hand-drawn shape. Guards the slow geometry checks against huge uploads. */
const MAX_VERTICES = 100_000;

export class TerritoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details: { issues?: ValidationIssue[]; overlaps?: OverlapReport[] } = {},
  ) {
    super(code);
  }
}

export interface Owner {
  kind: TerritoryOwnerKind;
  id: number;
  dioceseId: number;
  name: string;
  hasTerritory: boolean;
}

const parse = (text: string | null | undefined): MultiPolygon | null =>
  text ? (JSON.parse(text) as MultiPolygon) : null;

/** The shape work has reached: the draft if there is one, otherwise the published shape. */
const latest = (
  territory: { draftGeojson: string | null; publishedGeojson: string | null } | null,
) => parse(territory?.draftGeojson ?? territory?.publishedGeojson);

const ownerWhere = (owner: Owner) =>
  owner.kind === 'parish' ? { parishId: owner.id } : { dioceseId: owner.id };

export async function findOwner(
  prisma: PrismaClient,
  kind: TerritoryOwnerKind,
  id: number,
): Promise<Owner> {
  if (kind === 'parish') {
    const parish = await prisma.parish.findUnique({ where: { id } });
    if (parish) {
      return {
        kind,
        id,
        dioceseId: parish.dioceseId,
        name: parish.name,
        hasTerritory: parish.hasTerritory,
      };
    }
  } else {
    const diocese = await prisma.diocese.findUnique({ where: { id } });
    if (diocese) return { kind, id, dioceseId: id, name: diocese.name, hasTerritory: true };
  }
  throw new TerritoryError(404, 'not-found');
}

/** Latest shape of every parish that has territory, optionally leaving one out. */
async function parishShapes(prisma: PrismaClient, dioceseId: number, exceptParishId?: number) {
  const parishes = await prisma.parish.findMany({
    where: {
      dioceseId,
      hasTerritory: true,
      id: exceptParishId ? { not: exceptParishId } : undefined,
    },
    select: {
      id: true,
      name: true,
      territory: { select: { draftGeojson: true, publishedGeojson: true } },
    },
  });
  return parishes.flatMap((parish) => {
    const geometry = latest(parish.territory);
    return geometry ? [{ id: parish.id, name: parish.name, geometry }] : [];
  });
}

async function dioceseOutline(prisma: PrismaClient, dioceseId: number) {
  return latest(await prisma.territory.findUnique({ where: { dioceseId } }));
}

async function neighborsOf(prisma: PrismaClient, owner: Owner) {
  return parishShapes(prisma, owner.dioceseId, owner.kind === 'parish' ? owner.id : undefined);
}

/** Overlaps only matter between parishes. A diocese outline is meant to contain them. */
export async function checkShape(
  prisma: PrismaClient,
  owner: Owner,
  shape: MultiPolygon | null,
): Promise<TerritoryChecks> {
  if (!shape || owner.kind === 'diocese') return { overlaps: [], outside: null };

  const neighbors = await neighborsOf(prisma, owner);
  const names = new Map(neighbors.map((neighbor) => [neighbor.id, neighbor.name]));
  const outline = await dioceseOutline(prisma, owner.dioceseId);

  return {
    overlaps: findOverlaps(shape, neighbors).map((overlap) => ({
      id: overlap.id,
      name: names.get(overlap.id) ?? '',
      areaM2: overlap.areaM2,
      geometry: overlap.geometry,
    })),
    outside: outline ? findOutsideDiocese(shape, outline) : null,
  };
}

export async function getTerritory(prisma: PrismaClient, owner: Owner): Promise<AdminTerritory> {
  const territory = await prisma.territory.findUnique({ where: ownerWhere(owner) });
  const draft = parse(territory?.draftGeojson);
  const published = parse(territory?.publishedGeojson);

  return {
    kind: owner.kind,
    ownerId: owner.id,
    name: owner.name,
    draft,
    published,
    publishedAt: territory?.publishedAt?.toISOString() ?? null,
    updatedAt: territory?.updatedAt.toISOString() ?? null,
    confidence: (territory?.confidence as Confidence | undefined) ?? 'APPROXIMATE',
    notes: territory?.notes ?? '',
    sourceNotes: territory?.sourceNotes ?? '',
    checks: await checkShape(prisma, owner, draft ?? published),
    neighbors: await neighborsOf(prisma, owner),
    outline: owner.kind === 'parish' ? await dioceseOutline(prisma, owner.dioceseId) : null,
  };
}

/** Parses, cleans, and validates a submitted shape, or throws the reason it can't be used. */
export function readShape(input: unknown): MultiPolygon {
  const geometry = parseAreaGeometry(input);
  if (!geometry) throw new TerritoryError(422, 'invalid-geometry', { issues: ['empty'] });

  const vertexCount =
    geometry.type === 'Polygon'
      ? geometry.coordinates.flat().length
      : geometry.coordinates.flat(2).length;
  if (vertexCount > MAX_VERTICES) throw new TerritoryError(413, 'too-many-vertices');

  const shape = normalize(geometry);
  const issues = validate(shape);
  if (issues.length > 0) throw new TerritoryError(422, 'invalid-geometry', { issues });
  return shape;
}

function assertCanHaveTerritory(owner: Owner) {
  if (!owner.hasTerritory) throw new TerritoryError(409, 'no-territory');
}

export async function saveDraft(
  prisma: PrismaClient,
  owner: Owner,
  shape: MultiPolygon,
  action: Extract<VersionAction, 'SAVE' | 'IMPORT' | 'RESTORE'>,
) {
  assertCanHaveTerritory(owner);
  const geojson = JSON.stringify(shape);
  await prisma.$transaction(async (tx) => {
    const territory = await tx.territory.upsert({
      where: ownerWhere(owner),
      update: { draftGeojson: geojson },
      create: { ...ownerWhere(owner), draftGeojson: geojson },
    });
    await tx.territoryVersion.create({
      data: { territoryId: territory.id, geojson, action },
    });
  });
}

export async function updateMeta(
  prisma: PrismaClient,
  owner: Owner,
  meta: { confidence?: Confidence; notes?: string; sourceNotes?: string },
) {
  assertCanHaveTerritory(owner);
  await prisma.territory.upsert({
    where: ownerWhere(owner),
    update: meta,
    create: { ...ownerWhere(owner), ...meta },
  });
}

/** Publishes the draft. Overlaps block it until `confirmOverlaps` is sent, after showing them. */
export async function publish(prisma: PrismaClient, owner: Owner, confirmOverlaps: boolean) {
  assertCanHaveTerritory(owner);
  const territory = await prisma.territory.findUnique({ where: ownerWhere(owner) });
  const draftText = territory?.draftGeojson;
  if (!territory || !draftText) throw new TerritoryError(409, 'no-draft');

  const draft = parse(draftText)!;
  const issues = validate(draft);
  if (issues.length > 0) throw new TerritoryError(422, 'invalid-geometry', { issues });

  const { overlaps } = await checkShape(prisma, owner, draft);
  if (overlaps.length > 0 && !confirmOverlaps) {
    throw new TerritoryError(409, 'overlaps-need-confirmation', { overlaps });
  }

  await prisma.$transaction([
    prisma.territory.update({
      where: { id: territory.id },
      data: {
        publishedGeojson: draftText,
        publishedBbox: JSON.stringify(bboxOf(draft)),
        publishedAt: new Date(),
      },
    }),
    prisma.territoryVersion.create({
      data: { territoryId: territory.id, geojson: draftText, action: 'PUBLISH' },
    }),
  ]);
}

/** Takes a shape off the public site. It stays as a draft, so no work is lost. */
export async function unpublish(prisma: PrismaClient, owner: Owner) {
  const territory = await prisma.territory.findUnique({ where: ownerWhere(owner) });
  if (!territory?.publishedGeojson) throw new TerritoryError(409, 'not-published');
  await prisma.territory.update({
    where: { id: territory.id },
    data: {
      draftGeojson: territory.draftGeojson ?? territory.publishedGeojson,
      publishedGeojson: null,
      publishedBbox: null,
      publishedAt: null,
    },
  });
}

export async function trim(prisma: PrismaClient, owner: Owner, shape: MultiPolygon) {
  if (owner.kind === 'diocese') return shape;
  const neighbors = await neighborsOf(prisma, owner);
  const trimmed = trimToNeighbors(
    shape,
    neighbors.map((neighbor) => neighbor.geometry),
  );
  if (!trimmed) throw new TerritoryError(422, 'nothing-left-after-trim');
  return trimmed;
}

export async function listVersions(prisma: PrismaClient, owner: Owner) {
  const territory = await prisma.territory.findUnique({
    where: ownerWhere(owner),
    select: {
      versions: {
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, action: true, createdAt: true },
      },
    },
  });
  return (territory?.versions ?? []).map((version) => ({
    id: version.id,
    action: version.action,
    createdAt: version.createdAt.toISOString(),
  }));
}

/** Restores a version as the draft. The public site doesn't change until it's published. */
export async function restoreVersion(prisma: PrismaClient, owner: Owner, versionId: number) {
  const version = await prisma.territoryVersion.findFirst({
    where: { id: versionId, territory: ownerWhere(owner) },
  });
  if (!version) throw new TerritoryError(404, 'not-found');
  await saveDraft(prisma, owner, parse(version.geojson)!, 'RESTORE');
}

export async function getProgress(prisma: PrismaClient, dioceseId: number): Promise<AdminProgress> {
  const parishes = await prisma.parish.findMany({
    where: { dioceseId },
    select: {
      hasTerritory: true,
      territory: { select: { draftGeojson: true, publishedGeojson: true } },
    },
  });
  const mappable = parishes.filter((parish) => parish.hasTerritory);
  const published = mappable.filter((parish) => parish.territory?.publishedGeojson).length;
  const draftOnly = mappable.filter(
    (parish) => parish.territory?.draftGeojson && !parish.territory.publishedGeojson,
  ).length;

  const shapes = await parishShapes(prisma, dioceseId);
  const outline = await dioceseOutline(prisma, dioceseId);

  return {
    total: mappable.length,
    noTerritory: parishes.length - mappable.length,
    published,
    draftOnly,
    notStarted: mappable.length - published - draftOnly,
    outlineDrawn: outline !== null,
    gaps: outline
      ? findCoverageGaps(
          outline,
          shapes.map((shape) => shape.geometry),
        )
      : null,
    shapes,
    outline,
  };
}

/** All shapes with their private notes, for backups. It must stay behind admin login. */
export async function exportDiocese(prisma: PrismaClient, dioceseId: number, parishId?: number) {
  const diocese = await prisma.diocese.findUniqueOrThrow({
    where: { id: dioceseId },
    include: { territory: true },
  });
  const parishes = await prisma.parish.findMany({
    where: { dioceseId, id: parishId },
    include: { territory: true, vicariate: true },
    orderBy: { id: 'asc' },
  });

  const toFeatures = (
    territory: (typeof diocese)['territory'],
    properties: Record<string, unknown>,
  ) => {
    if (!territory) return [];
    const states = [
      ['draft', territory.draftGeojson],
      ['published', territory.publishedGeojson],
    ] as const;
    return states.flatMap(([state, geojson]) =>
      geojson
        ? [
            {
              type: 'Feature',
              geometry: JSON.parse(geojson) as MultiPolygon,
              properties: {
                ...properties,
                state,
                confidence: territory.confidence,
                notes: territory.notes,
                sourceNotes: territory.sourceNotes,
              },
            },
          ]
        : [],
    );
  };

  return {
    type: 'FeatureCollection',
    features: [
      ...(parishId
        ? []
        : toFeatures(diocese.territory, {
            kind: 'diocese',
            slug: diocese.slug,
            name: diocese.name,
          })),
      ...parishes.flatMap((parish) =>
        toFeatures(parish.territory, {
          kind: 'parish',
          slug: parish.slug,
          name: parish.name,
          vicariate: parish.vicariate.name,
        }),
      ),
    ],
  };
}
