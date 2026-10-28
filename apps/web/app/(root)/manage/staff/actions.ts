"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { cancelInvite, inviteMember, ownSections } from "@/lib/orgs/invites";
import { changeRole, removeMember, setStaffSections } from "@/lib/orgs/members";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { rootUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";

// Members and invites need the Auth admin API, so these use the service client; the owner check is the gate.
const pickSections: FormState = { ok: false, errors: { sectionIds: m.manage.pickSections } };
const sectionIdsOf = (form: FormData) => form.getAll("sectionIds").map(String);

const inviteSchema = z.object({ email: z.email(m.forms.required), role: z.enum(["owner", "staff"]) });

/** Invites someone by email as owner or staff (staff with the sections ticked). */
export async function inviteStaffAction(_state: FormState, form: FormData): Promise<FormState> {
  const { org, user } = await requireManager("owner");
  const parsed = inviteSchema.safeParse({ email: String(form.get("email") ?? "").trim(), role: form.get("role") });
  if (!parsed.success) return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const result = await inviteMember(createServiceClient(), {
    organizationId: org.id,
    email: parsed.data.email,
    role: parsed.data.role,
    sectionIds: sectionIdsOf(form),
    invitedBy: user.id,
    redirectTo: rootUrl("/auth/callback?next=/manage"),
  });
  if (result.status === "already_member") return { ok: false, message: m.manage.alreadyMember };
  if (result.status === "no_sections") return pickSections;
  refresh();
  return { ok: true, message: m.manage.invited(parsed.data.email.toLowerCase()) };
}

export async function cancelInviteAction(inviteId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  await cancelInvite(createServiceClient(), org.id, inviteId);
  refresh();
  return { ok: true, message: m.manage.inviteCancelled };
}

/** Sets which sections a staff member runs; they see the change on their next page. */
export async function setSectionsAction(userId: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const result = await setStaffSections(createServiceClient(), { organizationId: org.id, userId, sectionIds: sectionIdsOf(form) });
  if (result === "none_selected" || result === "invalid_section") return pickSections;
  if (result === "not_staff") return { ok: false, message: m.manage.staffPage.ownersRunAll };
  refresh();
  return { ok: true, message: m.manage.staffPage.sectionsSaved };
}

/** Staff → owner: they run every section. */
export async function makeOwnerAction(userId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  await changeRole(createServiceClient(), org.id, userId, "owner");
  refresh();
  return { ok: true, message: m.manage.saved };
}

/** Owner → staff, keeping the sections ticked (at least one). The last owner stays an owner. */
export async function makeStaffAction(userId: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const db = createServiceClient();
  const wanted = [...new Set(sectionIdsOf(form))];
  if (wanted.length === 0 || (await ownSections(db, org.id, wanted)).length !== wanted.length) return pickSections;
  const result = await changeRole(db, org.id, userId, "staff");
  if (result.status === "last_owner") return { ok: false, message: m.manage.lastOwner };
  await setStaffSections(db, { organizationId: org.id, userId, sectionIds: wanted });
  refresh();
  return { ok: true, message: m.manage.saved };
}

export async function removeMemberAction(userId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const result = await removeMember(createServiceClient(), org.id, userId);
  if (result.status === "last_owner") return { ok: false, message: m.manage.lastOwner };
  refresh();
  return { ok: true, message: m.manage.deleted };
}
