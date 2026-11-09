import type { MultiPolygon } from 'geojson';
import type { Confidence } from './index';

export type TerritoryOwnerKind = 'parish' | 'diocese';

export interface AdminVicariate {
  id: number;
  name: string;
}

export interface AdminParish {
  id: number;
  slug: string;
  name: string;
  sourceName: string | null;
  vicariateId: number;
  vicariate: string;
  hasTerritory: boolean;
  isPublished: boolean;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  priest: string | null;
  hasDraft: boolean;
  hasPublished: boolean;
  /** True when the draft differs from what the public site shows. */
  hasUnpublishedChanges: boolean;
  confidence: Confidence | null;
}

export interface AdminDiocese {
  id: number;
  slug: string;
  name: string;
  vicariates: AdminVicariate[];
  parishes: AdminParish[];
}

export interface AdminProgress {
  total: number;
  noTerritory: number;
  published: number;
  draftOnly: number;
  notStarted: number;
  outlineDrawn: boolean;
  /** Parts of the diocese no drawn parish covers. Null without an outline or with full coverage. */
  gaps: MultiPolygon | null;
  /** The latest shape of every parish, for the overview map. */
  shapes: { id: number; name: string; geometry: MultiPolygon }[];
  outline: MultiPolygon | null;
}

export interface OverlapReport {
  id: number;
  name: string;
  areaM2: number;
  geometry: MultiPolygon;
}

export interface TerritoryChecks {
  overlaps: OverlapReport[];
  /** Part of the shape beyond the diocese outline, if any. */
  outside: MultiPolygon | null;
}

export interface AdminTerritory {
  kind: TerritoryOwnerKind;
  ownerId: number;
  name: string;
  draft: MultiPolygon | null;
  published: MultiPolygon | null;
  publishedAt: string | null;
  updatedAt: string | null;
  confidence: Confidence;
  notes: string;
  sourceNotes: string;
  checks: TerritoryChecks;
  neighbors: { id: number; name: string; geometry: MultiPolygon }[];
  outline: MultiPolygon | null;
}

export interface TerritoryVersionSummary {
  id: number;
  action: string;
  createdAt: string;
}

export interface SatelliteConfig {
  tileUrl: string;
  attribution: string;
}

export interface AdminConfig {
  /** Null until an imagery provider is configured. */
  satellite: SatelliteConfig | null;
}

export interface ApiErrorBody {
  error: string;
  issues?: string[];
  overlaps?: OverlapReport[];
}
