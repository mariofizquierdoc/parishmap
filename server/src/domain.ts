export const CONFIDENCE_LEVELS = ['APPROXIMATE', 'CONFIRMED'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const VERSION_ACTIONS = ['SAVE', 'PUBLISH', 'RESTORE', 'IMPORT'] as const;
export type VersionAction = (typeof VERSION_ACTIONS)[number];

export { slugify } from '@parishmap/shared/slug';
