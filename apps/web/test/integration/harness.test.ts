import { afterAll, describe, expect, it } from 'vitest';
import { createTestUser, deleteTestUser, serviceDb, signedInClient } from './helpers';

const db = serviceDb();
const created: string[] = [];

afterAll(async () => {
  for (const id of created) await deleteTestUser(db, id);
});

describe('integration harness', () => {
  it('service client reaches the local database', async () => {
    const { error } = await db.from('organizations').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('a test user can sign in and read their own (empty) profiles', async () => {
    const user = await createTestUser(db);
    created.push(user.id);
    const client = await signedInClient(user.email, user.password);
    const { data, error } = await client.from('player_profiles').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
