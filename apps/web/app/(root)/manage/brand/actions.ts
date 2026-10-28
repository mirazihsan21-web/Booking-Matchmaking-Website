"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { publishOrganization } from "@/lib/orgs/publish";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

const schema = z.object({
  name: z.string().trim().min(2, m.forms.required).max(80, m.forms.tooLong),
  address: z.string().trim().max(200, m.forms.tooLong),
  logo_path: z.string().max(200),
});

/** A logo is one file in the brand's own folder: `<org>/logo….png|jpg|webp` (never SVG). */
const isLogoPath = (organizationId: string, path: string) => new RegExp(`^${organizationId}/logo[\\w-]*\\.(png|jpg|webp)$`).test(path);

/** The brand's name, address and logo (empty `logo_path` removes it). The section colours replaced the brand colours. */
export async function saveBrandAction(_state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const parsed = schema.safeParse(Object.fromEntries(["name", "address", "logo_path"].map((k) => [k, String(form.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const { name, address, logo_path: logo } = parsed.data;
  if (logo && !isLogoPath(org.id, logo)) return { ok: false, errors: { logo_path: m.manage.brandPage.logoAgain } };

  // The owner's own client: RLS lets owners change their organization and files in its folder.
  const supabase = await createClient();
  const { logo_path: before, ...branding } = org.branding;
  const { error } = await supabase
    .from("organizations")
    .update({ name, address, branding: { ...branding, ...(logo ? { logo_path: logo } : {}) } })
    .eq("id", org.id);
  if (error) return { ok: false, message: error.message };
  // Tidying only: the replaced or removed file is no longer shown anywhere.
  if (before && before !== logo) await supabase.storage.from("org-assets").remove([before]);
  refresh();
  return { ok: true, message: m.manage.saved };
}

/** Puts the site live once it has what players need (spaces and opening hours). */
export async function publishBrandAction(_state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const result = await publishOrganization(createServiceClient(), org.id);
  if (result.status === "live") {
    refresh();
    return { ok: true, message: m.manage.published };
  }
  if (result.status === "suspended") return { ok: false, message: m.manage.suspendedNotice };
  return { ok: false, message: m.manage.notReady(result.missing) };
}
