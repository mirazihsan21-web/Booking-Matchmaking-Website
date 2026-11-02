import { describe, expect, it } from 'vitest';
import { MASK, maskBadWords, normalizeWord, STARTER_WORDS } from '../lib/chat/filter';

describe('maskBadWords', () => {
  it('masks the built-in words, whatever the capitals', () => {
    expect(maskBadWords('what the fuck')).toBe(`what the ${MASK}`);
    expect(maskBadWords('Shit!')).toBe(`${MASK}!`);
    expect(maskBadWords('FUCKING hell')).toBe(`${MASK} hell`);
  });

  it('sees through look-alike symbols and stretched letters', () => {
    expect(maskBadWords('$h1t happens')).toBe(`${MASK} happens`);
    expect(maskBadWords('shiiiit')).toBe(MASK);
    expect(maskBadWords('a$$hole')).toBe(MASK);
  });

  it('keeps the spacing and punctuation around a masked word', () => {
    expect(maskBadWords('ok,shit,ok')).toBe(`ok,${MASK},ok`);
  });

  it('leaves normal text alone (whole words only)', () => {
    for (const text of [
      'first class pitch',
      'Scunthorpe United',
      'assess the shiitake',
      'as you like',
      'আজ রাতে খেলা হবে?',
      'see https://example.com/a?b=1',
    ]) {
      expect(maskBadWords(text)).toBe(text);
    }
  });

  it("masks the venue's own words, in Banglish or Bangla script", () => {
    expect(maskBadWords('tui ekta gadha', ['gadha'])).toBe(`tui ekta ${MASK}`);
    expect(maskBadWords('তুই একটা গাধা', ['গাধা'])).toBe(`তুই একটা ${MASK}`);
  });

  it('masks a phrase as one span', () => {
    expect(maskBadWords('you son of a gun', ['son of a gun'])).toBe(`you ${MASK}`);
    expect(maskBadWords('son of mine', ['son of a gun'])).toBe('son of mine');
  });

  it('has a starter list and a mask of three dots', () => {
    expect(MASK).toBe('●●●');
    expect(STARTER_WORDS).toEqual(expect.arrayContaining(['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt']));
  });
});

describe('normalizeWord', () => {
  it('lower-cases and maps look-alikes', () => {
    expect(normalizeWord('$H1T')).toBe('shit');
    expect(normalizeWord('@55')).toBe('ass');
    expect(normalizeWord('b4st3rd')).toBe('basterd');
  });
});
