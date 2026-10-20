"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import type { FormState } from "@/components/forms/action-form";
import { isPlatformAdmin } from "@/lib/admin/platform";
import { requireUser } from "@/lib/auth/dal";
import { setOrganizationStatus } from "@/lib/orgs/publish";
import { createServiceClient } from "@/lib/service-client";
import { m } from "@/messages";

export async function setStatusAction(organizationId: string, status: "live" | "suspended", _state: FormState, _form: FormData): Promise<FormState> {
  const user = await requireUser("/admin");
  const db = createServiceClient();
  if (!(await isPlatformAdmin(db, user.id))) notFound();
  await setOrganizationStatus(db, organizationId, status);
  refresh();
  return { ok: true, message: status === "suspended" ? m.admin.suspended : m.admin.restored };
}
