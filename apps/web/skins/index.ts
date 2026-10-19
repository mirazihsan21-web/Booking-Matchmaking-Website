import { boardgame } from './boardgame';
import type { Skin } from './types';

export type { Skin } from './types';

const skins: Record<string, Skin> = { boardgame };

export function getSkin(key: string): Skin {
  const skin = skins[key];
  if (!skin) throw new Error(`Unknown skin ${key}`);
  return skin;
}
