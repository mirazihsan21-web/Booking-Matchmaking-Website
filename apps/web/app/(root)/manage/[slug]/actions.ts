"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { publishOrganization } from "@/lib/orgs/publish";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";

const saved: FormState = { ok: true, message: m.manage.saved };
const fail = (error: { message: string }): FormState => ({ ok: false, message: error.message });

// ── Venue ────────────────────────────────────────────────────────────────────
export async function publishAction(slug: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const result = await publishOrganization(createServiceClient(), org.id);
  refresh();
  if (result.status === "live") return { ok: true, message: m.manage.published };
  if (result.status === "suspended") return { ok: false, message: m.manage.suspendedNotice };
  return { ok: false, message: m.manage.notReady(result.missing) };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const settingsSchema = z.object({
  name: z.string().trim().min(2, m.forms.required).max(80, m.forms.tooLong),
  address: z.string().trim().max(200, m.forms.tooLong),
  primary: z.string().regex(HEX, m.manage.colourFormat),
  accent: z.string().regex(HEX, m.manage.colourFormat),
  logo_path: z.string().max(200),
});

export async function saveSettingsAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const parsed = settingsSchema.safeParse(Object.fromEntries(["name", "address", "primary", "accent", "logo_path"].map((k) => [k, String(form.get(k) ?? "")])));
  if (!parsed.success) {
    return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const { name, address, primary, accent, logo_path } = parsed.data;
  // Logos only ever live in this organization's own folder.
  const logo = logo_path.startsWith(`${org.id}/`) ? logo_path : org.branding.logo_path;
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name, ...(form.has("address") ? { address } : {}), branding: { ...org.branding, primary, accent, ...(logo ? { logo_path: logo } : {}) } })
    .eq("id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

