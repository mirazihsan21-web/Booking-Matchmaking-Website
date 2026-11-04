"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { paymentNumbersEmail } from "@/lib/email/payment-numbers-email";
import { createEmailSender } from "@/lib/email/sender";
import { publishOrganization } from "@/lib/orgs/publish";
import { setPaymentNumbers } from "@/lib/payments/numbers";
import { ownerEmails } from "@/lib/payments/team-emails";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/tenancy/manager";
import { rootUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";

const schema = z.object({
  name: z.string().trim().min(2, m.forms.required).max(80, m.forms.tooLong),
  address: z.string().trim().max(200, m.forms.tooLong),
  logo_path: z.string().max(200),
});

/** A logo is one file in the brand's own folder: `<org>/logo….png|jpg|webp` (never SVG). */
const isLogoPath = (organizationId: string, path: string) => new RegExp(`^${organizationId}/logo[\\w-]*\\.(png|jpg|webp)$`).test(path);

/** The brand's name, address and logo (empty `logo_path` removes it). The section colours replaced the brand colours. */
export async function saveBrandAction(_state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const parsed = schema.safeParse(Object.fromEntries(["name", "address", "logo_path"].map((k) => [k, String(form.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const { name, address, logo_path: logo } = parsed.data;
  if (logo && !isLogoPath(org.id, logo)) return { ok: false, errors: { logo_path: m.manage.brandPage.logoAgain } };

  // The owner's own client: RLS lets owners change their organization and files in its folder.
  const supabase = await createClient();
  const { logo_path: before, ...branding } = org.branding;
  const { error } = await supabase
    .from("organizations")
    .update({ name, address, branding: { ...branding, ...(logo ? { logo_path: logo } : {}) } })
    .eq("id", org.id);
  if (error) return { ok: false, message: error.message };
  // Tidying only: the replaced or removed file is no longer shown anywhere.
  if (before && before !== logo) await supabase.storage.from("org-assets").remove([before]);
  refresh();
  return { ok: true, message: m.manage.saved };
}

/** Puts the site live once it has what players need (spaces and opening hours). */
export async function publishBrandAction(_state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireManager("owner");
  const result = await publishOrganization(createServiceClient(), org.id);
  if (result.status === "live") {
    refresh();
    return { ok: true, message: m.manage.published };
  }
  if (result.status === "suspended") return { ok: false, message: m.manage.suspendedNotice };
  return { ok: false, message: m.manage.notReady(result.missing) };
}

const PHONE = /^01[3-9][0-9]{8}$/;

/**
 * The bKash and Nagad numbers players send money to for online bookings (owners only). Spaces are dropped; an
 * empty one is cleared. When a number changes, every owner is emailed what changed and who changed it.
 */
export async function savePaymentNumbersAction(_state: FormState, form: FormData): Promise<FormState> {
  const manager = await requireManager("owner");
  const read = (name: string) => String(form.get(name) ?? "").replace(/\s/g, "") || null;
  const bkash = read("bkash");
  const nagad = read("nagad");
  const b = m.manage.brandPage;
  const errors: Record<string, string> = {};
  if (bkash && !PHONE.test(bkash)) errors.bkash = b.numbersInvalid;
  if (nagad && !PHONE.test(nagad)) errors.nagad = b.numbersInvalid;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const db = createServiceClient();
  const result = await setPaymentNumbers(db, { organizationId: manager.org.id, userId: manager.user.id, bkash, nagad });
  if (result.status === "invalid") return { ok: false, message: b.numbersInvalid };
  if (result.status === "not_allowed") return { ok: false, message: m.manage.desk.notYourSection };
  if (result.old.bkash !== bkash || result.old.nagad !== nagad) {
    const tellOwners = async () => {
      const email = paymentNumbersEmail({
        venueName: manager.org.name,
        primaryColour: manager.org.branding.primary ?? "",
        changedBy: manager.displayName,
        before: result.old,
        after: { bkash, nagad },
        link: rootUrl("/manage/brand"),
      });
      const sender = createEmailSender(process.env);
      await Promise.all((await ownerEmails(db, manager.org.id)).map((to) => sender.send({ to, ...email })));
    };
    await tellOwners().catch((error) => console.error("payment-numbers email", error));
  }
  refresh();
  return { ok: true, message: b.numbersSaved };
}
