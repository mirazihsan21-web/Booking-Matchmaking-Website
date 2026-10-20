"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { parseActivityForm } from "@/lib/forms/activity";
import { parseBranchForm } from "@/lib/forms/branch";
import { parseResourceForm } from "@/lib/forms/resource";
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
  primary: z.string().regex(HEX, m.manage.colourFormat),
  accent: z.string().regex(HEX, m.manage.colourFormat),
  logo_path: z.string().max(200),
});

export async function saveSettingsAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const parsed = settingsSchema.safeParse(Object.fromEntries(["name", "primary", "accent", "logo_path"].map((k) => [k, String(form.get(k) ?? "")])));
  if (!parsed.success) {
    return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const { name, primary, accent, logo_path } = parsed.data;
  // Logos only ever live in this organization's own folder.
  const logo = logo_path.startsWith(`${org.id}/`) ? logo_path : org.branding.logo_path;
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name, branding: { ...org.branding, primary, accent, ...(logo ? { logo_path: logo } : {}) } })
    .eq("id", org.id);
  if (error) return fail(error);
  refresh();
  return saved;
}

// ── Branches ─────────────────────────────────────────────────────────────────
export async function saveBranchAction(slug: string, branchId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const parsed = parseBranchForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const row = { name: parsed.value.name, address: parsed.value.address, opening_hours: parsed.value.openingHours };
  const supabase = await createClient();
  const { error } = branchId
    ? await supabase.from("branches").update(row).eq("id", branchId).eq("organization_id", org.id)
    : await supabase.from("branches").insert({ ...row, organization_id: org.id });
  if (error) return fail(error);
  refresh();
  return saved;
}

export async function deleteBranchAction(slug: string, branchId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "owner");
  const supabase = await createClient();
  const { count } = await supabase.from("branches").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
  if ((count ?? 0) <= 1) return { ok: false, message: m.manage.lastBranch };
  const { error } = await supabase.from("branches").delete().eq("id", branchId).eq("organization_id", org.id);
  if (error?.code === "23503") return { ok: false, message: m.manage.branchInUse };
  if (error) return fail(error);
  refresh();
  return { ok: true, message: m.manage.deleted };
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
  };
  if (resourceId) {
    const { error } = await supabase.from("resources").update(row).eq("id", resourceId).eq("organization_id", org.id);
    if (error) return fail(error);
  } else {
    // RLS checks the organization; also make sure the branch is this organization's.
    const branchId = String(form.get("branchId") ?? "");
    const { data: branch } = await supabase.from("branches").select("id").eq("id", branchId).eq("organization_id", org.id).maybeSingle();
    if (!branch) return { ok: false, errors: { branchId: m.forms.choose } };
    const { error } = await supabase.from("resources").insert({ ...row, organization_id: org.id, branch_id: branch.id });
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
  const { error } = activityId
    ? await supabase.from("activities").update(row).eq("id", activityId).eq("organization_id", org.id)
    : await supabase.from("activities").insert({ ...row, organization_id: org.id });
  if (error) return fail(error);
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
    invitedBy: user.id,
    redirectTo: rootUrl("/auth/callback?next=/manage"),
  });
  refresh();
  if (result.status === "already_member") return { ok: false, message: m.manage.alreadyMember };
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
