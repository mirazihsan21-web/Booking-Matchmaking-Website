import type { CSSProperties } from 'react';

/** Puts a section's colour in `--section`, which section-coloured pieces read (side line, name, main button). */
export function sectionStyle(accent: string): CSSProperties {
  return { '--section': accent } as CSSProperties;
}
