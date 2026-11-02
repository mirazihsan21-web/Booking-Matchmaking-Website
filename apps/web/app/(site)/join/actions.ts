"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/action-form";
import { getUser } from "@/lib/auth/dal";
import { acceptPendingInvites, declineInvites } from "@/lib/orgs/invites";
import { createServiceClient } from "@/lib/service-client";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

/** Yes: the signed-in person's invite to the brand's team becomes a membership, and they go to Manage. */
export async function joinTeamAction(_state: FormState, _form: FormData): Promise<FormState> {
  const [user, brand] = await Promise.all([getUser(), getBrand()]);
  if (!user?.email || !brand) return { ok: false, message: m.join.gone };
  const joined = await acceptPendingInvites(createServiceClient(), user.id, user.email, brand.id);
  if (joined === 0) return { ok: false, message: m.join.gone };
  redirect("/manage");
}

/** No thanks: the invite is deleted (the owner sees it gone from Pending invites), and they go back to the site. */
export async function declineTeamAction(_state: FormState, _form: FormData): Promise<FormState> {
  const [user, brand] = await Promise.all([getUser(), getBrand()]);
  if (user?.email && brand) await declineInvites(createServiceClient(), brand.id, user.email);
  redirect("/");
}
