import { describe, expect, it } from 'vitest';
import { movedTo, routeRequest } from '../lib/site/route';

const root = 'localhost:3000';
const at = (path: string) => new URL(`http://localhost:3000${path}`);

describe('routeRequest (one site, no venue subdomains)', () => {
  it('sends an old venue link to the same page on the site (Review Focus 1)', () => {
    expect(routeRequest('chattoturf.localhost:3000', at('/me/bookings?x=1'), root)).toEqual({
      kind: 'redirect',
      location: 'http://localhost:3000/me/bookings?x=1',
    });
    expect(routeRequest('a.b.localhost:3000', at('/'), root)).toEqual({ kind: 'redirect', location: 'http://localhost:3000/' });
  });

  it('serves the site on its own host', () => {
    expect(routeRequest('localhost:3000', at('/turf'), root)).toEqual({ kind: 'next' });
    expect(routeRequest('www.localhost:3000', at('/turf'), root)).toEqual({ kind: 'next' });
    expect(routeRequest(null, at('/'), root)).toEqual({ kind: 'next' });
  });

  it('never serves the old internal venue routes', () => {
    expect(routeRequest('localhost:3000', at('/t/chattoturf'), root)).toEqual({ kind: 'not_found' });
    expect(routeRequest('localhost:3000', at('/t'), root)).toEqual({ kind: 'not_found' });
  });

  it('leaves other hosts (preview deployments) alone', () => {
    expect(routeRequest('preview-123.vercel.app', at('/turf'), root)).toEqual({ kind: 'next' });
  });

  it('redirects over https for a real domain', () => {
    expect(routeRequest('chattoturf.chattoturf.com', new URL('https://chattoturf.com/turf'), 'chattoturf.com')).toEqual({
      kind: 'redirect',
      location: 'https://chattoturf.com/turf',
    });
  });
});

describe('movedTo (where /api/moved sends an old venue link)', () => {
  it('is the same page on the site, absolute', () => {
    expect(movedTo('/me/bookings?x=1', root)).toBe('http://localhost:3000/me/bookings?x=1');
    expect(movedTo('/turf', 'chattoturf.com')).toBe('https://chattoturf.com/turf');
  });

  it('never leaves the site (no open redirect)', () => {
    expect(movedTo('//evil.example', root)).toBe('http://localhost:3000/');
    expect(movedTo('https://evil.example', root)).toBe('http://localhost:3000/');
    expect(movedTo(null, root)).toBe('http://localhost:3000/');
  });
});
