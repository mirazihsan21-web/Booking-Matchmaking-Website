import { m } from '@/messages';
import type { BusinessType } from '@/presets/types';

/** A section kind's own wording on the site: its main action, booking action and what its games are called. */
export function kindWords(kind: BusinessType): { join: string; book: string; games: string; noGames: string } {
  return m.site.kinds[kind];
}

const PHOTOS = { turf: '/sections/turf.jpg', boardgame_cafe: '/sections/cafe.jpg', gaming_lounge: '/sections/lounge.jpg' } as const;

/** The photo for a section kind (files in `public/sections`, credited in its CREDITS.md). */
export function sectionPhoto(kind: BusinessType): (typeof PHOTOS)[BusinessType] {
  return PHOTOS[kind];
}
