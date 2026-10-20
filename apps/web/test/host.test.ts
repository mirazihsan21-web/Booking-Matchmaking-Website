import { describe, expect, it } from 'vitest';
import { resolveHost } from '../lib/tenancy/host';

const ROOT = 'localhost:3000';

describe('resolveHost (Review Focus 2)', () => {
  it.each([
    ['localhost:3000', { kind: 'root' }],
    ['www.localhost:3000', { kind: 'root' }],
    ['Dhanmondi-Turf.localhost:3000', { kind: 'tenant', slug: 'dhanmondi-turf' }],
    ['dhanmondi-turf.localhost:3000', { kind: 'tenant', slug: 'dhanmondi-turf' }],
    ['a.b.localhost:3000', { kind: 'unknown' }],
    ['admin.localhost:3000', { kind: 'unknown' }],
    ['-bad.localhost:3000', { kind: 'unknown' }],
    ['my-app.vercel.app', { kind: 'root' }],
    [null, { kind: 'root' }],
  ])('%s → %j', (host, expected) => {
    expect(resolveHost(host, ROOT)).toEqual(expected);
  });

  it('works with a production root domain', () => {
    expect(resolveHost('turf.play.example.com', 'play.example.com')).toEqual({ kind: 'tenant', slug: 'turf' });
    expect(resolveHost('play.example.com', 'play.example.com')).toEqual({ kind: 'root' });
    expect(resolveHost('PLAY.EXAMPLE.COM', 'play.example.com')).toEqual({ kind: 'root' });
  });
});
