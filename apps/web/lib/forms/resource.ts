import { z } from 'zod';
import { m } from '@/messages';
import { bdtToPoisha } from '@/lib/money';
import type { ResourceKind } from '@/presets';
import { fieldErrors, text, type FormResult } from './result';

export const RESOURCE_KINDS = ['table', 'pitch', 'court', 'zone', 'pod'] as const;

const schema = z.object({
  name: z.string().min(1, m.forms.required).max(60, m.forms.tooLong),
  kind: z.enum(RESOURCE_KINDS, { error: m.forms.choose }),
  capacity: z.coerce.number({ error: m.forms.wholeNumber }).int(m.forms.wholeNumber).min(1, m.forms.capacityRange).max(30, m.forms.capacityRange),
  price: z.string().refine((p) => p === '' || bdtToPoisha(p) !== null, m.forms.price),
  slotMinutes: z.coerce
    .number({ error: m.forms.slotLength })
    .int(m.forms.slotLength)
    .min(15, m.forms.slotLength)
    .max(240, m.forms.slotLength)
    .refine((n) => n % 15 === 0, m.forms.slotLength),
});

export interface ResourceInput {
  name: string;
  kind: ResourceKind;
  capacity: number;
  pricePerHourPoisha: number | null;
  /** Booking slot length; slots run on a grid from opening time. */
  slotMinutes: number;
}

export function parseResourceForm(formData: FormData): FormResult<ResourceInput> {
  const parsed = schema.safeParse({
    name: text(formData, 'name'),
    kind: text(formData, 'kind'),
    capacity: text(formData, 'capacity'),
    price: text(formData, 'price'),
    // Blank is "not a number", not 0.
    slotMinutes: text(formData, 'slotMinutes') || Number.NaN,
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { name, kind, capacity, price, slotMinutes } = parsed.data;
  return { ok: true, value: { name, kind, capacity, pricePerHourPoisha: price === '' ? null : bdtToPoisha(price), slotMinutes } };
}
