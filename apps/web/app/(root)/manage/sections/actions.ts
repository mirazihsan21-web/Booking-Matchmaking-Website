"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { parseActivityForm } from "@/lib/forms/activity";
import { parseResourceForm } from "@/lib/forms/resource";
import { parseSectionForm } from "@/lib/forms/section";
import { saveSectionWebsite } from "@/lib/sections/website";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

const saved: FormState = { ok: true, message: m.manage.saved };
const fail = (error: { message: string }): FormState => ({ ok: false, message: error.message });

/** True when the section is one of the brand's (an owner may change any of them). */
async function isOwnSection(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string, sectionId: string): Promise<boolean> {
  const { data } = await supabase.from("sections").select("id").eq("id", sectionId).eq("organization_id", organizationId).maybeSingle();
  return Boolean(data);
}

// ── Sections ─────────────────────────────────────────────────────────────────
/** A section's name, opening hours, booking rules and seat-offer time. */
export async function saveSectionAction(sectionId: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const parsed = parseSectionForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const v = parsed.value;
  const { error } = await (await createClient())
    .from("sections")
    .update({
      name: v.name,
      opening_hours: v.openingHours,
      booking_horizon_days: v.bookingHorizonDays,
      cancel_cutoff_minutes: v.cancelCutoffMinutes,
      match_cutoff_minutes: v.matchCutoffMinutes,
      max_upcoming_bookings: v.maxUpcomingBookings,
      offer_ttl_seconds: v.offerTtlSeconds,
    })
    .eq("id", sectionId)
    .eq("organization_id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

const addSectionSchema = z.object({
  kind: z.enum(["turf", "boardgame_cafe", "gaming_lounge"], { error: m.forms.choose }),
  name: z.string().trim().min(1, m.forms.required).max(80, m.forms.tooLong),
});

/** A new section of a kind; add_section picks its web address, colour and place in the list. */
export async function addSectionAction(_state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const parsed = addSectionSchema.safeParse({ kind: form.get("kind"), name: String(form.get("name") ?? "") });
  if (!parsed.success) return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  // add_section is service-role only; the owner check above is the gate.
  const { error } = await createServiceClient().rpc("add_section", { p_organization_id: org.id, p_kind: parsed.data.kind, p_name: parsed.data.name });
  if (error) return fail(error);
  refresh();
  return saved;
}

/** Removes a section — refused for the last one, or while it has spaces in use, bookings or games. */
export async function deleteSectionAction(sectionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const supabase = await createClient();
  const { count } = await supabase.from("sections").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
  if ((count ?? 0) <= 1) return { ok: false, message: m.manage.lastSection };
  const { error } = await supabase.from("sections").delete().eq("id", sectionId).eq("organization_id", org.id);
  if (error?.code === "23503") return { ok: false, message: m.manage.sectionInUse };
  if (error) return fail(error);
  refresh();
  return { ok: true, message: m.manage.deleted };
}

/** What the website shows for a section: name, description, photo and a colour that stays readable. */
export async function saveWebsiteAction(sectionId: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const w = m.manage.website;
  const photo = String(form.get("photo_path") ?? "");
  // The owner's own client: RLS lets owners change their sections and remove files in their folder.
  const result = await saveSectionWebsite(await createClient(), {
    organizationId: org.id,
    sectionId,
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    accent: String(form.get("accent") ?? ""),
    photoPath: photo || null,
  });
  switch (result.status) {
    case "saved":
      refresh();
      return saved;
    case "unreadable":
      return { ok: false, errors: { accent: w.unreadable(result.ratio) } };
    case "invalid":
      return { ok: false, errors: { [result.field]: { name: w.nameRule, description: w.tooLong, accent: w.badColour }[result.field] } };
    case "invalid_photo":
      return { ok: false, errors: { photo_path: w.photoAgain } };
    case "not_found":
      return { ok: false, message: w.notFound };
  }
}

// ── Spaces ───────────────────────────────────────────────────────────────────
/** Adds a space to this section (`resourceId` null) or saves an existing one. */
export async function saveResourceAction(sectionId: string, resourceId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const parsed = parseResourceForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const supabase = await createClient();
  const row = {
    name: parsed.value.name,
    kind: parsed.value.kind,
    capacity: parsed.value.capacity,
    price_per_hour_poisha: parsed.value.pricePerHourPoisha,
    slot_minutes: parsed.value.slotMinutes,
  };
  if (resourceId) {
    const { error } = await supabase.from("resources").update(row).eq("id", resourceId).eq("organization_id", org.id);
    if (error) return fail(error);
  } else {
    if (!(await isOwnSection(supabase, org.id, sectionId))) return { ok: false, message: m.forms.choose };
    const { error } = await supabase.from("resources").insert({ ...row, organization_id: org.id, section_id: sectionId });
    if (error) return fail(error);
  }
  refresh();
  return saved;
}

export async function setResourceActiveAction(resourceId: string, active: boolean, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const { error } = await (await createClient()).from("resources").update({ active }).eq("id", resourceId).eq("organization_id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

// ── Games ────────────────────────────────────────────────────────────────────
/** Adds a game to this section (`activityId` null) or saves an existing one. */
export async function saveActivityAction(sectionId: string, activityId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const parsed = parseActivityForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const v = parsed.value;
  const row = {
    name: v.name,
    team_mode: v.teamMode,
    team_size: v.teamSize,
    min_players: v.minPlayers,
    max_players: v.maxPlayers,
    duration_min: v.durationMin,
  };
  const supabase = await createClient();
  if (activityId) {
    const { error } = await supabase.from("activities").update(row).eq("id", activityId).eq("organization_id", org.id);
    if (error) return fail(error);
  } else {
    if (!(await isOwnSection(supabase, org.id, sectionId))) return { ok: false, message: m.forms.choose };
    const { error } = await supabase.from("activities").insert({ ...row, organization_id: org.id, section_id: sectionId });
    if (error) return fail(error);
  }
  refresh();
  return saved;
}

export async function setActivityActiveAction(activityId: string, active: boolean, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const { error } = await (await createClient()).from("activities").update({ active }).eq("id", activityId).eq("organization_id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

export async function deleteActivityAction(activityId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const { error } = await (await createClient()).from("activities").delete().eq("id", activityId).eq("organization_id", org.id);
  if (error?.code === "23503") return { ok: false, message: m.manage.activityInUse };
  if (error) return fail(error);
  refresh();
  return { ok: true, message: m.manage.deleted };
}
