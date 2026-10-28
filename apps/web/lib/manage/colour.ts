import { contrastRatio } from '@/lib/site/contrast';
import { TOKENS } from '@/lib/site/tokens';

const NEEDED = 4.5;

/**
 * Whether a section colour stays readable, by the same two checks the built-in colours pass: the colour as
 * text on cards, and dark text on the colour's buttons. Both need 4.5:1.
 */
export function accentReadability(hex: string): { onCard: number; onColour: number; ok: boolean } {
  const onCard = contrastRatio(hex, TOKENS.card);
  const onColour = contrastRatio(TOKENS.onSection, hex);
  return { onCard, onColour, ok: onCard >= NEEDED && onColour >= NEEDED };
}
