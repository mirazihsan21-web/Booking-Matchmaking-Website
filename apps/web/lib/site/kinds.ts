import type { Section } from '@/lib/sections/sections';
import { assetUrl } from '@/lib/tenancy/urls';
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

/** A section's photo on the site: the one the owner uploaded, else its kind's stock photo. */
export function sectionPhotoUrl(section: Pick<Section, 'kind' | 'photoPath'>): string {
  return section.photoPath ? assetUrl(section.photoPath) : sectionPhoto(section.kind);
}

/** A section's text on the site: the owner's description, else its kind's general text. */
export function sectionBlurb(section: Pick<Section, 'kind' | 'description'>): string {
  return section.description ?? m.site.landing.blurb[section.kind];
}
