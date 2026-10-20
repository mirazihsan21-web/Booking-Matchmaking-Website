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
});

export interface ResourceInput {
  name: string;
  kind: ResourceKind;
  capacity: number;
  pricePerHourPoisha: number | null;
}

export function parseResourceForm(formData: FormData): FormResult<ResourceInput> {
  const parsed = schema.safeParse({
    name: text(formData, 'name'),
    kind: text(formData, 'kind'),
    capacity: text(formData, 'capacity'),
    price: text(formData, 'price'),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const { name, kind, capacity, price } = parsed.data;
  return { ok: true, value: { name, kind, capacity, pricePerHourPoisha: price === '' ? null : bdtToPoisha(price) } };
}
