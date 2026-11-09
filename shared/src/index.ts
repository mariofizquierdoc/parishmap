import type { BBox, Feature, FeatureCollection, MultiPolygon } from 'geojson';

export interface HealthResponse {
  status: 'ok';
  database: 'ok';
}

export type Confidence = 'APPROXIMATE' | 'CONFIRMED';

export interface PublicDioceseSummary {
  slug: string;
  name: string;
}

export interface PublicDiocese extends PublicDioceseSummary {
  sourceUrl: string | null;
  /** Published outline, or null if it hasn't been drawn yet. */
  outline: MultiPolygon | null;
}

export interface PublicParish {
  slug: string;
  name: string;
  vicariate: string;
  /** False for churches with no territory of their own. */
  hasTerritory: boolean;
  /** True when a territory is published and can be shown on the map. */
  hasPublishedTerritory: boolean;
  /** Null unless a territory is published. */
  confidence: Confidence | null;
  /** ISO date. Null unless a territory is published. */
  territoryUpdatedAt: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  priest: string | null;
}

export interface PublicVicariate {
  name: string;
  parishes: PublicParish[];
}

export interface PublicParishList {
  vicariates: PublicVicariate[];
}

export interface PublicTerritoryProperties {
  slug: string;
  name: string;
  confidence: Confidence;
}

export type PublicTerritoryFeature = Feature<MultiPolygon, PublicTerritoryProperties>;
export type PublicTerritoryCollection = FeatureCollection<MultiPolygon, PublicTerritoryProperties>;

export type { BBox };
