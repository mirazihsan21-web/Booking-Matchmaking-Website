import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = (file: string) => fileURLToPath(new URL(`../public/sections/${file}`, import.meta.url));
const PHOTOS = ['turf.jpg', 'cafe.jpg', 'lounge.jpg'];

describe('section photos', () => {
  it.each(PHOTOS)('%s is a small JPEG', (file) => {
    expect(existsSync(dir(file))).toBe(true);
    const bytes = readFileSync(dir(file));
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(statSync(dir(file)).size).toBeLessThanOrEqual(250 * 1024);
  });

  it('credits every photo with its source and licence', () => {
    const credits = readFileSync(dir('CREDITS.md'), 'utf8');
    for (const file of PHOTOS) {
      const line = credits.split('\n').find((l) => l.includes(file));
      expect(line, file).toBeDefined();
      expect(line).toMatch(/https:\/\/(unsplash\.com|www\.pexels\.com)\//);
      expect(line).toMatch(/Unsplash License|Pexels License/);
    }
  });
});
