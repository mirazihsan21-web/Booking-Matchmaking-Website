import { z } from 'zod';
import { m } from '@/messages';
import { fieldErrors, text, type FormResult } from './result';

/** A reason the chat's database functions refuse something; `m.chat.refusal` has a sentence for each. */
export type ChatRefusal = keyof typeof m.chat.refusal;

/** Characters as people count them (an emoji or a Bangla letter is one), the way Postgres's char_length does. */
const chars = (value: string) => [...value].length;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (message: string) => z.string().regex(UUID, message);
const note = z.string().refine((value) => chars(value) <= 200, m.chat.errors.noteTooLong);
const orNull = (value: string) => (value === '' ? null : value);

const messageSchema = z.object({
  body: z
    .string()
    .min(1, m.chat.errors.empty)
    .refine((value) => chars(value) <= 500, m.chat.errors.tooLong(500)),
});

/** The chat box: 1–500 characters after trimming. */
export function parseChatMessageForm(formData: FormData): FormResult<{ body: string }> {
  const parsed = messageSchema.safeParse({ body: text(formData, 'body') });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, value: parsed.data };
}

export type CardTarget = { kind: 'booking'; bookingId: string } | { kind: 'session'; sessionId: string };

const TARGET = /^(booking|session):([0-9a-f-]{36})$/i;

/**
 * "Need players": what the card is for (`booking:<id>` or `session:<id>`), how many players a booking is short
 * (1–20; sessions have seats instead, so it is ignored) and an optional note of up to 200 characters.
 */
export function parseCardForm(formData: FormData): FormResult<{ target: CardTarget; spots: number | null; note: string | null }> {
  const errors: Record<string, string> = {};
  const match = TARGET.exec(text(formData, 'target'));
  const target: CardTarget | null =
    match && UUID.test(match[2]!) ? (match[1] === 'booking' ? { kind: 'booking', bookingId: match[2]! } : { kind: 'session', sessionId: match[2]! }) : null;
  if (!target) errors.target = m.chat.errors.target;

  let spots: number | null = null;
  if (target?.kind === 'booking') {
    const raw = text(formData, 'spots');
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > 20) errors.spots = m.chat.errors.spots;
    else spots = value;
  }

  const parsedNote = note.safeParse(text(formData, 'note'));
  if (!parsedNote.success) errors.note = m.chat.errors.noteTooLong;

  if (Object.keys(errors).length > 0 || !target) return { ok: false, errors };
  return { ok: true, value: { target, spots, note: orNull(parsedNote.data!) } };
}

const reportSchema = z.object({
  messageId: uuid(m.chat.refusal.not_found),
  reason: z.enum(['spam', 'abuse', 'other'], { message: m.chat.errors.reason }),
  note,
});

/** Report a message: spam, rude or abusive, or other (photos come with stage C2), with an optional note. */
export function parseReportForm(formData: FormData): FormResult<{ messageId: string; reason: 'spam' | 'abuse' | 'other'; note: string | null }> {
  const parsed = reportSchema.safeParse({ messageId: text(formData, 'messageId'), reason: text(formData, 'reason'), note: text(formData, 'note') });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, value: { ...parsed.data, note: orNull(parsed.data.note) } };
}

const muteSchema = z.object({
  profileId: uuid(m.chat.refusal.not_found),
  length: z.enum(['1', '7', 'forever'], { message: m.chat.errors.length }),
});

/** Mute a player for 1 day, 7 days or until unmuted (`days: null`). */
export function parseMuteForm(formData: FormData): FormResult<{ profileId: string; days: 1 | 7 | null }> {
  const parsed = muteSchema.safeParse({ profileId: text(formData, 'profileId'), length: text(formData, 'length') });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const days = parsed.data.length === 'forever' ? null : (Number(parsed.data.length) as 1 | 7);
  return { ok: true, value: { profileId: parsed.data.profileId, days } };
}

const wordSchema = z.object({ word: z.string().refine((value) => chars(value) >= 2 && chars(value) <= 40, m.chat.errors.word) });

/** A word for the venue's list: lower-cased, single spaces, 2–40 characters. */
export function parseBlockedWordForm(formData: FormData): FormResult<{ word: string }> {
  const word = text(formData, 'word').replace(/\s+/g, ' ').toLowerCase();
  const parsed = wordSchema.safeParse({ word });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, value: parsed.data };
}
