import { boardgame } from './boardgame';
import { lounge } from './lounge';
import { turf } from './turf';
import type { BusinessType, Preset } from './types';

export type { BusinessType, Preset, ResourceKind, TeamMode } from './types';

export const PRESETS: Record<BusinessType, Preset> = {
  boardgame_cafe: boardgame,
  turf,
  gaming_lounge: lounge,
};

export function getPreset(type: string): Preset {
  const preset = PRESETS[type as BusinessType];
  if (!preset) throw new Error(`Unknown business type ${type}`);
  return preset;
}
