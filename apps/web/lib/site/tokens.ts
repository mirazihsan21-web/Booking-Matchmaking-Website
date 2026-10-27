import type { BusinessType } from '@/presets/types';

/**
 * The site's colours (dark only, "matte night"). `app/globals.css` declares the same values as CSS
 * variables; a test keeps the two in step and checks every pair we put text on meets WCAG AA.
 */
export const TOKENS = {
  background: '#0f1115',
  card: '#171a21',
  raised: '#1d2129',
  border: '#2b313b',
  foreground: '#eef0f3',
  mutedForeground: '#aab2bb',
  warning: '#e0a43a',
  /** Text on a section colour (buttons, selected slots). */
  onSection: '#0f1115',
} as const;

/** Each section kind's default colour; `sections.accent` starts from these (private.kind_accent). */
export const SECTION_COLOURS: Record<BusinessType, string> = {
  turf: '#43a66b',
  boardgame_cafe: '#2e9e93',
  gaming_lounge: '#8a78e6',
};
