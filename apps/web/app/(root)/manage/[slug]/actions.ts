"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { parseActivityForm } from "@/lib/forms/activity";
import { parseResourceForm } from "@/lib/forms/resource";
import { parseSectionForm } from "@/lib/forms/section";
import { cancelInvite, inviteMember } from "@/lib/orgs/invites";
import { changeRole, removeMember } from "@/lib/orgs/members";
import { publishOrganization } from "@/lib/orgs/publish";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { rootUrl } from "@/lib/tenancy/urls";
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

// ── Sections ─────────────────────────────────────────────────────────────────
export async function saveSectionAction(slug: string, sectionId: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const parsed = parseSectionForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const v = parsed.value;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sections")
    .update({
      name: v.name,
      opening_hours: v.openingHours,
      booking_horizon_days: v.bookingHorizonDays,
      cancel_cutoff_minutes: v.cancelCutoffMinutes,
      match_cutoff_minutes: v.matchCutoffMinutes,
      max_upcoming_bookings: v.maxUpcomingBookings,
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

/** A new section of a kind; add_section picks its web address, accent and place in the list. */
export async function addSectionAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const parsed = addSectionSchema.safeParse({ kind: form.get("kind"), name: String(form.get("name") ?? "") });
  if (!parsed.success) return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  // add_section is service-role only; the owner check above is the gate.
  const { error } = await createServiceClient().rpc("add_section", { p_organization_id: org.id, p_kind: parsed.data.kind, p_name: parsed.data.name });
  if (error) return fail(error);
  refresh();
  return saved;
}

export async function deleteSectionAction(slug: string, sectionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const supabase = await createClient();
  const { count } = await supabase.from("sections").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
  if ((count ?? 0) <= 1) return { ok: false, message: m.manage.lastSection };
  const { error } = await supabase.from("sections").delete().eq("id", sectionId).eq("organization_id", org.id);
  if (error?.code === "23503") return { ok: false, message: m.manage.sectionInUse };
  if (error) return fail(error);
  refresh();
  return { ok: true, message: m.manage.deleted };
}

/** The section id from a form, if it is one of this organization's sections. */
async function ownSection(supabase: Awaited<ReturnType<typeof createClient>>, organizationId: string, form: FormData): Promise<string | null> {
  const sectionId = String(form.get("sectionId") ?? "");
  const { data } = await supabase.from("sections").select("id").eq("id", sectionId).eq("organization_id", organizationId).maybeSingle();
  return data?.id ?? null;
}

// ── Resources ────────────────────────────────────────────────────────────────
export async function saveResourceAction(slug: string, resourceId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
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
    // RLS checks the organization; also make sure the section is this organization's.
    const sectionId = await ownSection(supabase, org.id, form);
    if (!sectionId) return { ok: false, errors: { sectionId: m.forms.choose } };
    const { error } = await supabase.from("resources").insert({ ...row, organization_id: org.id, section_id: sectionId });
    if (error) return fail(error);
  }
  refresh();
  return saved;
}

export async function setResourceActiveAction(slug: string, resourceId: string, active: boolean, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const supabase = await createClient();
  const { error } = await supabase.from("resources").update({ active }).eq("id", resourceId).eq("organization_id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

// ── Activities ───────────────────────────────────────────────────────────────
export async function saveActivityAction(slug: string, activityId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
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
    // A new game belongs to one section (its favourites, ratings and matching are that section's).
    const sectionId = await ownSection(supabase, org.id, form);
    if (!sectionId) return { ok: false, errors: { sectionId: m.forms.choose } };
    const { error } = await supabase.from("activities").insert({ ...row, organization_id: org.id, section_id: sectionId });
    if (error) return fail(error);
  }
  refresh();
  return saved;
}

export async function setActivityActiveAction(slug: string, activityId: string, active: boolean, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const supabase = await createClient();
  const { error } = await supabase.from("activities").update({ active }).eq("id", activityId).eq("organization_id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

export async function deleteActivityAction(slug: string, activityId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const supabase = await createClient();
  const { error } = await supabase.from("activities").delete().eq("id", activityId).eq("organization_id", org.id);
  if (error?.code === "23503") return { ok: false, message: m.manage.activityInUse };
  if (error) return fail(error);
  refresh();
  return { ok: true, message: m.manage.deleted };
}

// ── Staff ────────────────────────────────────────────────────────────────────
const inviteSchema = z.object({ email: z.email(m.forms.required), role: z.enum(["owner", "staff"]) });

export async function inviteStaffAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org, user } = await requireOrgRole(slug, "owner");
  const parsed = inviteSchema.safeParse({ email: String(form.get("email") ?? "").trim(), role: form.get("role") });
  if (!parsed.success) return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const result = await inviteMember(createServiceClient(), {
    organizationId: org.id,
    email: parsed.data.email,
    role: parsed.data.role,
    sectionIds: form.getAll("sectionIds").map(String),
    invitedBy: user.id,
    redirectTo: rootUrl("/auth/callback?next=/manage"),
  });
  refresh();
  if (result.status === "already_member") return { ok: false, message: m.manage.alreadyMember };
  if (result.status === "no_sections") return { ok: false, errors: { sectionIds: m.manage.pickSections } };
  return { ok: true, message: m.manage.invited(parsed.data.email.toLowerCase()) };
}

export async function cancelInviteAction(slug: string, inviteId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  await cancelInvite(createServiceClient(), org.id, inviteId);
  refresh();
  return { ok: true, message: m.manage.inviteCancelled };
}

export async function changeRoleAction(slug: string, userId: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const role = form.get("role") === "owner" ? "owner" : "staff";
  const result = await changeRole(createServiceClient(), org.id, userId, role);
  refresh();
  return result.status === "ok" ? saved : { ok: false, message: m.manage.lastOwner };
}

export async function removeMemberAction(slug: string, userId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const result = await removeMember(createServiceClient(), org.id, userId);
  refresh();
  return result.status === "ok" ? { ok: true, message: m.manage.deleted } : { ok: false, message: m.manage.lastOwner };
}
