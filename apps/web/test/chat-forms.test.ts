import { describe, expect, it } from 'vitest';
import { parseBlockedWordForm, parseCardForm, parseChatMessageForm, parseMuteForm, parseReportForm } from '../lib/forms/chat';
import { m } from '../messages';

const ID = '00000000-0000-4000-8000-000000000001';
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
};

describe('parseChatMessageForm', () => {
  it('trims the text and refuses an empty message', () => {
    expect(parseChatMessageForm(form({ body: '  hi all  ' }))).toEqual({ ok: true, value: { body: 'hi all' } });
    expect(parseChatMessageForm(form({ body: '   ' }))).toEqual({ ok: false, errors: { body: m.chat.errors.empty } });
    expect(parseChatMessageForm(form({}))).toEqual({ ok: false, errors: { body: m.chat.errors.empty } });
  });

  it('counts characters, not UTF-16 units: 500 emoji or Bangla letters fit, 501 do not', () => {
    expect(parseChatMessageForm(form({ body: '⚽'.repeat(500) })).ok).toBe(true);
    expect(parseChatMessageForm(form({ body: 'খ'.repeat(500) })).ok).toBe(true);
    expect(parseChatMessageForm(form({ body: '⚽'.repeat(501) }))).toEqual({ ok: false, errors: { body: m.chat.errors.tooLong(500) } });
  });
});

describe('parseCardForm', () => {
  it('reads a booking card with its spots and note', () => {
    expect(parseCardForm(form({ target: `booking:${ID}`, spots: '3', note: ' split the cost ' }))).toEqual({
      ok: true,
      value: { target: { kind: 'booking', bookingId: ID }, spots: 3, note: 'split the cost' },
    });
  });

  it('needs 1 to 20 whole spots for a booking', () => {
    for (const spots of ['0', '21', '2.5', '', 'x']) {
      const result = parseCardForm(form({ target: `booking:${ID}`, spots }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.errors)).toEqual(['spots']);
    }
  });

  it('ignores spots for a session and keeps no note as null', () => {
    expect(parseCardForm(form({ target: `session:${ID}`, note: '' }))).toEqual({
      ok: true,
      value: { target: { kind: 'session', sessionId: ID }, spots: null, note: null },
    });
  });

  it('refuses an unknown target and a note over 200 characters', () => {
    const bad = parseCardForm(form({ target: 'x', spots: '2' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.target).toBeDefined();
    const long = parseCardForm(form({ target: `booking:${ID}`, spots: '2', note: '⚽'.repeat(201) }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.note).toBeDefined();
    expect(parseCardForm(form({ target: `booking:${ID}`, spots: '2', note: '⚽'.repeat(200) })).ok).toBe(true);
  });
});

describe('parseReportForm', () => {
  it('reads a reason and an optional note', () => {
    expect(parseReportForm(form({ messageId: ID, reason: 'spam', note: '' }))).toEqual({ ok: true, value: { messageId: ID, reason: 'spam', note: null } });
    expect(parseReportForm(form({ messageId: ID, reason: 'abuse', note: 'rude to my friend' }))).toEqual({
      ok: true,
      value: { messageId: ID, reason: 'abuse', note: 'rude to my friend' },
    });
  });

  it('has no photo reason until photos exist', () => {
    expect(parseReportForm(form({ messageId: ID, reason: 'photo' })).ok).toBe(false);
    expect(parseReportForm(form({ messageId: 'nope', reason: 'spam' })).ok).toBe(false);
  });
});

describe('parseMuteForm', () => {
  it('mutes for 1 day, 7 days or until unmuted', () => {
    expect(parseMuteForm(form({ profileId: ID, length: '1' }))).toEqual({ ok: true, value: { profileId: ID, days: 1 } });
    expect(parseMuteForm(form({ profileId: ID, length: '7' }))).toEqual({ ok: true, value: { profileId: ID, days: 7 } });
    expect(parseMuteForm(form({ profileId: ID, length: 'forever' }))).toEqual({ ok: true, value: { profileId: ID, days: null } });
    expect(parseMuteForm(form({ profileId: ID, length: '3' })).ok).toBe(false);
  });
});

describe('parseBlockedWordForm', () => {
  it('stores words lower-cased with single spaces, 2–40 characters', () => {
    expect(parseBlockedWordForm(form({ word: '  Son  Of ' }))).toEqual({ ok: true, value: { word: 'son of' } });
    expect(parseBlockedWordForm(form({ word: 'গাধা' }))).toEqual({ ok: true, value: { word: 'গাধা' } });
    expect(parseBlockedWordForm(form({ word: 'a' })).ok).toBe(false);
    expect(parseBlockedWordForm(form({ word: 'x'.repeat(41) })).ok).toBe(false);
  });
});

describe('refusal words', () => {
  it('has a sentence for every refusal the database gives', () => {
    for (const key of [
      'muted', 'too_fast', 'no_profile', 'invalid', 'not_found', 'not_allowed', 'not_yours', 'already_posted', 'too_many_cards',
      'bad_spots', 'single_space', 'not_going', 'not_open', 'own_card', 'already_asked', 'too_many_waiting', 'full',
      'already_reported', 'own_message', 'too_many_reports', 'exists', 'too_many_words', 'nothing_open',
    ]) {
      expect(m.chat.refusal[key as keyof typeof m.chat.refusal], key).toMatch(/\.$/);
    }
  });
});
