import type { Skin } from '@/skins';

/** Skin palette → the shadcn CSS variables it overrides (applied inline on <html>). */
export function skinToCssVars(skin: Skin): Record<string, string> {
  return {
    '--primary': skin.palette.primary,
    '--accent': skin.palette.accent,
    '--background': skin.palette.background,
    '--foreground': skin.palette.foreground,
  };
}
