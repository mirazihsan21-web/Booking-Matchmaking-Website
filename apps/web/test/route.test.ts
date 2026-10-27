import { describe, expect, it } from 'vitest';
import { movedBookPath, movedTo, routeRequest } from '../lib/site/route';

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

describe('movedBookPath (an old venue booking link, Review Focus 1)', () => {
  const S = '7b0f5d36-1111-4222-8333-944455556666';
  const R = '0c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff';

  it("goes to its section's booking page, keeping the space and the day", () => {
    expect(movedBookPath(`?section=${S}&resource=${R}&date=2026-10-30`, 'cafe')).toBe(`/cafe/book?resource=${R}&date=2026-10-30`);
    expect(movedBookPath('', 'turf')).toBe('/turf/book');
  });

  it('goes home when the section is unknown', () => {
    expect(movedBookPath('?date=2026-10-30', null)).toBe('/');
  });
});
