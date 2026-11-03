"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/action-form";
import { getUser } from "@/lib/auth/dal";
import { safeNext } from "@/lib/auth/redirect";
import { parseProfileForm } from "@/lib/forms/profile";
import { saveProfile } from "@/lib/profiles/save-profile";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";
import { teamRefusal } from "@/lib/tenancy/team-refusal";
import { m } from "@/messages";

/**
 * Saves the signed-in player's profile (one per brand), through RLS as that player, then shows it (/me) — or goes
 * back to the page that sent them to set it up (`next`, same-site paths only).
 */
export async function saveProfileAction(_state: FormState, form: FormData): Promise<FormState> {
  const [user, brand] = await Promise.all([getUser(), getBrand()]);
  if (!user || !brand) return { ok: false, message: m.profile.unavailable };
  const refused = teamRefusal(await getSitePlayer());
  if (refused) return refused;

  const parsed = parseProfileForm(form, brand.sections.map((s) => s.id));
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const result = await saveProfile(await createClient(), { userId: user.id, organizationId: brand.id, input: parsed.value });
  refresh();
  const next = form.get("next");
  if (result.status === "saved") redirect(typeof next === "string" && next ? safeNext(next) : "/me?saved=1");
  if (result.status === "phone_taken") return { ok: false, errors: { phone: m.profile.phoneTaken } };
  return { ok: false, message: m.profile.unavailable };
}
