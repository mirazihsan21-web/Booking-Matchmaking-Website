import { z } from 'zod';
import { m } from '@/messages';
import type { TeamMode } from '@/presets';
import { fieldErrors, text, type FormResult } from './result';

export interface ActivityInput {
  name: string;
  teamMode: TeamMode;
  teamSize: number | null;
  minPlayers: number;
  maxPlayers: number;
  durationMin: number;
}

const count = (min: number, max: number, message: string) =>
  z.coerce.number({ error: m.forms.wholeNumber }).int(m.forms.wholeNumber).min(min, message).max(max, message);

const base = z.object({
  name: z.string().min(1, m.forms.required).max(60, m.forms.tooLong),
  durationMin: count(5, 600, m.forms.durationRange),
});

const twoTeams = base.extend({ teamMode: z.literal('two_teams'), teamSize: count(1, 15, m.forms.teamSizeRange) });
const freeForAll = base
  .extend({ teamMode: z.literal('none'), minPlayers: count(1, 30, m.forms.playersRange), maxPlayers: count(1, 30, m.forms.playersRange) })
  .refine((v) => v.minPlayers <= v.maxPlayers, { message: m.forms.minAboveMax, path: ['maxPlayers'] });

/** Two-team activities derive min = max = 2 × team size, matching the database rule. */
export function parseActivityForm(formData: FormData): FormResult<ActivityInput> {
  const raw = {
    name: text(formData, 'name'),
    durationMin: text(formData, 'durationMin'),
    teamMode: text(formData, 'teamMode'),
    teamSize: text(formData, 'teamSize') || undefined,
    minPlayers: text(formData, 'minPlayers') || undefined,
    maxPlayers: text(formData, 'maxPlayers') || undefined,
  };
  if (raw.teamMode === 'two_teams') {
    const parsed = twoTeams.safeParse({ ...raw, teamSize: raw.teamSize ?? '' });
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
    const { name, durationMin, teamSize } = parsed.data;
    return { ok: true, value: { name, teamMode: 'two_teams', teamSize, minPlayers: 2 * teamSize, maxPlayers: 2 * teamSize, durationMin } };
  }
  const parsed = freeForAll.safeParse({ ...raw, teamMode: 'none', minPlayers: raw.minPlayers ?? '', maxPlayers: raw.maxPlayers ?? '' });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { name, durationMin, minPlayers, maxPlayers } = parsed.data;
  return { ok: true, value: { name, teamMode: 'none', teamSize: null, minPlayers, maxPlayers, durationMin } };
}
