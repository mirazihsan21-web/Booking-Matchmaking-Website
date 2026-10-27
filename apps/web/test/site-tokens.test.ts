import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../lib/site/contrast';
import { SECTION_COLOURS, TOKENS } from '../lib/site/tokens';

// WCAG AA for normal text.
const AA = 4.5;

describe('contrastRatio', () => {
  it('measures black on white as 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });
});

describe('design tokens', () => {
  it('every text colour reads on every surface', () => {
    for (const text of [TOKENS.foreground, TOKENS.mutedForeground]) {
      for (const surface of [TOKENS.background, TOKENS.card, TOKENS.raised]) {
        expect(contrastRatio(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    }
    expect(contrastRatio(TOKENS.warning, TOKENS.card)).toBeGreaterThanOrEqual(AA);
  });

  it('section colours read both ways: dark text on them, and them on cards', () => {
    for (const colour of Object.values(SECTION_COLOURS)) {
      expect(contrastRatio(TOKENS.onSection, colour), `text on ${colour}`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(colour, TOKENS.card), `${colour} on card`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('globals.css declares the same values', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
    const declared = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();
    expect(declared('background')).toBe(TOKENS.background);
    expect(declared('card')).toBe(TOKENS.card);
    expect(declared('raised')).toBe(TOKENS.raised);
    expect(declared('border')).toBe(TOKENS.border);
    expect(declared('foreground')).toBe(TOKENS.foreground);
    expect(declared('muted-foreground')).toBe(TOKENS.mutedForeground);
    expect(declared('warning')).toBe(TOKENS.warning);
  });
});
