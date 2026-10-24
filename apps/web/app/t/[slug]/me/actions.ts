"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { getUser } from "@/lib/auth/dal";
import { parseProfileForm } from "@/lib/forms/profile";
import { saveProfile } from "@/lib/profiles/save-profile";
import { loadSections } from "@/lib/sections/sections";
import { createClient } from "@/lib/supabase/server";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { m } from "@/messages";

/** Saves the signed-in player's profile at this venue, through RLS as that player. */
export async function saveProfileAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const user = await getUser();
  const org = await getLiveOrganization(slug);
  if (!user || !org) return { ok: false, message: m.profile.unavailable };

  const sections = await loadSections(await createClient(), org.id);
  const parsed = parseProfileForm(form, sections.map((s) => s.id));
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const result = await saveProfile(await createClient(), { userId: user.id, organizationId: org.id, input: parsed.value });
  refresh();
  if (result.status === "saved") return { ok: true, message: m.profile.saved };
  if (result.status === "phone_taken") return { ok: false, errors: { phone: m.profile.phoneTaken } };
  return { ok: false, message: m.profile.unavailable };
}
