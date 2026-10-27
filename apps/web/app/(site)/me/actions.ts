"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { getUser } from "@/lib/auth/dal";
import { parseProfileForm } from "@/lib/forms/profile";
import { saveProfile } from "@/lib/profiles/save-profile";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

/** Saves the signed-in player's profile (one per brand), through RLS as that player. */
export async function saveProfileAction(_state: FormState, form: FormData): Promise<FormState> {
  const [user, brand] = await Promise.all([getUser(), getBrand()]);
  if (!user || !brand) return { ok: false, message: m.profile.unavailable };

  const parsed = parseProfileForm(form, brand.sections.map((s) => s.id));
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const result = await saveProfile(await createClient(), { userId: user.id, organizationId: brand.id, input: parsed.value });
  refresh();
  if (result.status === "saved") return { ok: true, message: m.profile.saved };
  if (result.status === "phone_taken") return { ok: false, errors: { phone: m.profile.phoneTaken } };
  return { ok: false, message: m.profile.unavailable };
}
