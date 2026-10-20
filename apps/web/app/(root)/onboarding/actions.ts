"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/forms/action-form";
import { requireUser } from "@/lib/auth/dal";
import { checkSlug, createOrganization, type SlugCheck } from "@/lib/orgs/create-organization";
import { createServiceClient } from "@/lib/service-client";
import { m } from "@/messages";
import { PRESETS, type BusinessType } from "@/presets";

/** Live web-address check for the wizard. Signed-in users only, so slugs can't be enumerated anonymously. */
export async function checkSlugAction(input: string): Promise<SlugCheck> {
  await requireUser("/onboarding");
  return checkSlug(createServiceClient(), input);
}

export async function createOrganizationAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("/onboarding");
  const businessType = String(form.get("businessType") ?? "");
  if (!(businessType in PRESETS)) return { ok: false, message: m.onboarding.pickType };

  const result = await createOrganization(createServiceClient(), {
    userId: user.id,
    businessType: businessType as BusinessType,
    name: String(form.get("name") ?? ""),
    slug: String(form.get("slug") ?? ""),
  });
  switch (result.status) {
    case "created":
      redirect(`/onboarding?org=${result.slug}&step=branding`);
    case "invalid_name":
      return { ok: false, errors: { name: m.onboarding.nameLength } };
    case "slug_taken":
      return { ok: false, errors: { slug: m.onboarding.slugTaken } };
    case "invalid_slug":
      return { ok: false, errors: { slug: result.reason === "reserved" ? m.onboarding.slugReserved : m.onboarding.slugFormat } };
  }
}
