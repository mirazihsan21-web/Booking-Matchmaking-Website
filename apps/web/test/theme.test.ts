import { describe, expect, it } from 'vitest';
import { PLATFORM_PALETTE, brandingToCssVars } from '../lib/theme';

const fallback = { primary: '#000000', accent: '#FFFFFF' };

describe('brandingToCssVars', () => {
  it('uses valid brand colours', () => {
    expect(brandingToCssVars({ primary: '#15803D', accent: '#FACC15' }, fallback)).toEqual({
      '--primary': '#15803D',
      '--accent': '#FACC15',
    });
  });

  it('falls back for missing or invalid colours', () => {
    expect(brandingToCssVars({ primary: 'red' }, fallback)).toEqual({ '--primary': '#000000', '--accent': '#FFFFFF' });
  });

  it('exposes the platform palette', () => {
    expect(PLATFORM_PALETTE).toEqual({ primary: '#0F172A', accent: '#38BDF8' });
  });
});
