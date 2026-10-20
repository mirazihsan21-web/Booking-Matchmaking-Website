"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { bdtToPoisha } from "@/lib/money";
import type { OpeningHours } from "@/lib/opening-hours";
import { cancelOpenPlay, scheduleOpenPlay } from "@/lib/schedule/schedule";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";

const schema = z.object({
  branchId: z.uuid(m.forms.choose),
  activityId: z.union([z.uuid(), z.literal("")]),
  resourceIds: z.array(z.uuid()).min(1, m.schedule.pickResource),
  date: z.iso.date(m.schedule.pickDate),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, m.forms.timeFormat),
  durationMin: z.coerce.number().int().min(15, m.schedule.durationRange).max(600, m.schedule.durationRange),
  weeks: z.coerce.number().int().min(1, m.schedule.weeksRange).max(12, m.schedule.weeksRange),
  seatPrice: z.string().refine((p) => bdtToPoisha(p) !== null, m.forms.price),
});

/** Staff can run the schedule. Writes go through the schedule RPC (service role) after the role check. */
export async function scheduleAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "staff");
  const parsed = schema.safeParse({
    branchId: form.get("branchId"),
    activityId: form.get("activityId") ?? "",
    resourceIds: form.getAll("resourceIds"),
    date: form.get("date"),
    time: form.get("time"),
    durationMin: form.get("durationMin"),
    weeks: form.get("weeks"),
    seatPrice: String(form.get("seatPrice") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const v = parsed.data;

  const supabase = await createClient();
  const { data: branch } = await supabase.from("branches").select("opening_hours").eq("id", v.branchId).eq("organization_id", org.id).maybeSingle();
  if (!branch) return { ok: false, errors: { branchId: m.forms.choose } };

  const result = await scheduleOpenPlay(createServiceClient(), {
    organizationId: org.id,
    branchId: v.branchId,
    activityId: v.activityId || null,
    resourceIds: v.resourceIds,
    first: { date: v.date, time: v.time },
    weeks: v.weeks,
    durationMin: v.durationMin,
    seatPricePoisha: bdtToPoisha(v.seatPrice)!,
    timeZone: org.timezone,
    openingHours: branch.opening_hours as OpeningHours,
  });
  refresh();
  switch (result.status) {
    case "scheduled":
      return { ok: true, message: m.schedule.scheduled(result.sessionIds.length) };
    case "clash":
      return { ok: false, message: m.schedule.clash(result.at) };
    case "outside_hours":
      return { ok: false, message: m.schedule.outsideHours(result.at) };
    case "invalid":
      return { ok: false, message: m.schedule.invalid };
  }
}

export async function cancelSessionAction(slug: string, sessionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org } = await requireOrgRole(slug, "staff");
  const supabase = await createClient();
  const { data: session } = await supabase.from("open_play_sessions").select("id").eq("id", sessionId).eq("organization_id", org.id).maybeSingle();
  if (!session) return { ok: false, message: m.schedule.invalid };
  const result = await cancelOpenPlay(createServiceClient(), session.id);
  refresh();
  return result === "cancelled" ? { ok: true, message: m.schedule.cancelled } : { ok: false, message: m.schedule.notOpen };
}
