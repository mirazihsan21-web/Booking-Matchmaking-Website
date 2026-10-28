import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSections } from '@/lib/sections/sections';
import { saveSectionWebsite } from '@/lib/sections/website';
import { boardgame } from '@/presets/boardgame';
import { lounge } from '@/presets/lounge';
import { turf } from '@/presets/turf';
import { setupBrand } from '../../scripts/brand-setup-core.mjs';
import { serviceDb } from './helpers';

// Two brands; what the website shows is saved per section, and a photo must sit in that section's folder.
const db = serviceDb();
const slug = `web-${randomUUID().slice(0, 8)}`;
const otherSlug = `web-${randomUUID().slice(0, 8)}`;
let orgId: string;
let otherOrgId: string;
let turfId: string;
let cafeId: string;

const orgOf = async (s: string) => {
  const { data, error } = await db.from('organizations').select('id').eq('slug', s).single();
  if (error) throw error;
  return data.id as string;
};

beforeAll(async () => {
  await setupBrand(db, { slug, name: 'Web Arena', presets: [turf, boardgame, lounge] });
  await setupBrand(db, { slug: otherSlug, name: 'Other Arena', presets: [turf, boardgame, lounge] });
  [orgId, otherOrgId] = await Promise.all([orgOf(slug), orgOf(otherSlug)]);
  const sections = await loadSections(db, orgId);
  turfId = sections.find((s) => s.kind === 'turf')!.id;
  cafeId = sections.find((s) => s.kind === 'boardgame_cafe')!.id;
});

afterAll(async () => {
  await db.from('organizations').delete().in('id', [orgId, otherOrgId]);
});

describe('saveSectionWebsite', () => {
  const base = () => ({ organizationId: orgId, sectionId: turfId, name: 'Turf', description: '', accent: '#4ade80', photoPath: null });

  it('saves the name, description, a readable colour and a photo in the section folder', async () => {
    const photoPath = `${orgId}/sections/${turfId}/a1b2c3.jpg`;
    const result = await saveSectionWebsite(db, { ...base(), name: 'The Turf', description: 'Floodlit 5-a-side pitches.', accent: '#22c55e', photoPath });
    expect(result).toEqual({ status: 'saved' });
    const turfNow = (await loadSections(db, orgId)).find((s) => s.id === turfId)!;
    expect(turfNow).toMatchObject({ name: 'The Turf', description: 'Floodlit 5-a-side pitches.', accent: '#22c55e', photoPath, slug: 'turf' });
  });

  it('keeps an empty description and no photo as nothing (the kind text and stock photo show)', async () => {
    expect(await saveSectionWebsite(db, { ...base(), description: '   ' })).toEqual({ status: 'saved' });
    const turfNow = (await loadSections(db, orgId)).find((s) => s.id === turfId)!;
    expect(turfNow.description).toBeNull();
    expect(turfNow.photoPath).toBeNull();
  });

  it('refuses a colour that would be hard to read, with the measured ratio', async () => {
    const result = await saveSectionWebsite(db, { ...base(), accent: '#2b313b' });
    expect(result.status).toBe('unreadable');
    if (result.status === 'unreadable') expect(result.ratio).toBeCloseTo(1.33, 2);
    expect((await loadSections(db, orgId)).find((s) => s.id === turfId)!.accent).not.toBe('#2b313b');
  });

  it("refuses a photo from another section's or brand's folder", async () => {
    for (const photoPath of [`${orgId}/sections/${cafeId}/x.jpg`, `${otherOrgId}/sections/${turfId}/x.jpg`, `${orgId}/logo.png`, `${orgId}/sections/${turfId}/../${cafeId}/x.jpg`]) {
      expect(await saveSectionWebsite(db, { ...base(), photoPath })).toEqual({ status: 'invalid_photo' });
    }
  });

  it('refuses a description over 300 characters, an empty name and a colour that is not #rrggbb', async () => {
    expect(await saveSectionWebsite(db, { ...base(), description: 'x'.repeat(301) })).toEqual({ status: 'invalid', field: 'description' });
    expect(await saveSectionWebsite(db, { ...base(), description: 'x'.repeat(300) })).toEqual({ status: 'saved' });
    expect(await saveSectionWebsite(db, { ...base(), name: ' ' })).toEqual({ status: 'invalid', field: 'name' });
    expect(await saveSectionWebsite(db, { ...base(), accent: 'red' })).toEqual({ status: 'invalid', field: 'accent' });
  });

  it('removes the photo it replaces from storage', async () => {
    const bucket = db.storage.from('org-assets');
    const first = `${orgId}/sections/${cafeId}/first.png`;
    const second = `${orgId}/sections/${cafeId}/second.png`;
    for (const path of [first, second]) {
      const { error } = await bucket.upload(path, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), { contentType: 'image/png', upsert: true });
      if (error) throw error;
    }
    const cafe = { organizationId: orgId, sectionId: cafeId, name: 'Café', description: '', accent: '#2dd4bf' };
    expect(await saveSectionWebsite(db, { ...cafe, photoPath: first })).toEqual({ status: 'saved' });
    expect(await saveSectionWebsite(db, { ...cafe, photoPath: second })).toEqual({ status: 'saved' });
    const { data: files } = await bucket.list(`${orgId}/sections/${cafeId}`);
    expect((files ?? []).map((f) => f.name)).toEqual(['second.png']);
    expect(await saveSectionWebsite(db, { ...cafe, photoPath: null })).toEqual({ status: 'saved' });
    expect((await bucket.list(`${orgId}/sections/${cafeId}`)).data ?? []).toEqual([]);
  });

  it("doesn't touch another brand's section", async () => {
    const other = (await loadSections(db, otherOrgId)).find((s) => s.kind === 'turf')!;
    expect(await saveSectionWebsite(db, { ...base(), sectionId: other.id, name: 'Taken' })).toEqual({ status: 'not_found' });
    expect((await loadSections(db, otherOrgId)).find((s) => s.id === other.id)!.name).toBe(other.name);
  });
});
