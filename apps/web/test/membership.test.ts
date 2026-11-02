import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readTeamMembership } from '../lib/tenancy/membership';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000b1';

/** A client whose every request gets this response, so no database is needed. */
function clientAnswering(status: number, body: unknown) {
  return createClient('http://db.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) },
  });
}

describe('readTeamMembership (final review, minor 7)', () => {
  it("throws when the read fails, e.g. code deployed before the migration, instead of looking like 'not on the team'", async () => {
    const db = clientAnswering(400, { code: '42703', message: 'column organization_members.display_name does not exist', details: null, hint: null });
    await expect(readTeamMembership(db, ORG, USER)).rejects.toMatchObject({ code: '42703' });
  });

  it('is null for someone who is not on the team', async () => {
    expect(await readTeamMembership(clientAnswering(200, []), ORG, USER)).toBeNull();
  });

  it("returns the member's role, name, mobile and join date", async () => {
    const row = { role: 'owner', display_name: 'Miraz Ihsan', phone: null, created_at: '2026-10-25T10:00:00Z' };
    expect(await readTeamMembership(clientAnswering(200, [row]), ORG, USER)).toEqual({
      role: 'owner',
      displayName: 'Miraz Ihsan',
      phone: null,
      memberSince: '2026-10-25T10:00:00Z',
    });
  });
});
