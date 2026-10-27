/** Fallback colours (e.g. an email's accent when the brand has none) and branding → CSS variables. */
export const PLATFORM_PALETTE = { primary: '#0F172A', accent: '#38BDF8' } as const;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A venue's brand colours → the shadcn CSS variables they override. Invalid colours fall back. */
export function brandingToCssVars(
  branding: { primary?: string; accent?: string },
  fallback: { primary: string; accent: string },
): Record<string, string> {
  const pick = (value: string | undefined, otherwise: string) => (value && HEX.test(value) ? value : otherwise);
  return {
    '--primary': pick(branding.primary, fallback.primary),
    '--accent': pick(branding.accent, fallback.accent),
  };
}
