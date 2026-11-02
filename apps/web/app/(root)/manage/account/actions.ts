"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { parseTeamDetailsForm } from "@/lib/forms/team-details";
import { updateMyTeamDetails } from "@/lib/orgs/members";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/** The signed-in owner or staff member saves their own name and mobile (only their own row). */
export async function saveMyDetailsAction(_state: FormState, form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const parsed = parseTeamDetailsForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  try {
    const result = await updateMyTeamDetails(createServiceClient(), { organizationId: manager.org.id, userId: manager.user.id, ...parsed.value });
    if (result.status !== "saved") return { ok: false, message: m.manage.account.saveFailed };
  } catch {
    return { ok: false, message: m.manage.account.saveFailed };
  }
  refresh();
  return { ok: true, message: m.manage.account.saved };
}
