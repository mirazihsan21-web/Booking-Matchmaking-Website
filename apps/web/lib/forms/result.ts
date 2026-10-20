import type { z } from 'zod';

export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** zod issues → one message per field (the first), keyed by the field name. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
  }
  return errors;
}

export const text = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();
