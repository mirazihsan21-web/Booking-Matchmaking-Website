"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/forms/action-form";
import { bdtToPoisha } from "@/lib/money";
import { cancelOpenPlay, scheduleOpenPlay } from "@/lib/schedule/schedule";
import { loadSection, sectionOfSession } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

const schema = z.object({
  sectionId: z.uuid(m.forms.choose),
  activityId: z.union([z.uuid(), z.literal("")]),
  resourceIds: z.array(z.uuid()).min(1, m.schedule.pickResource),
  date: z.iso.date(m.schedule.pickDate),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, m.forms.timeFormat),
  durationMin: z.coerce.number().int().min(15, m.schedule.durationRange).max(600, m.schedule.durationRange),
  weeks: z.coerce.number().int().min(1, m.schedule.weeksRange).max(12, m.schedule.weeksRange),
  seatPrice: z.string().refine((p) => bdtToPoisha(p) !== null, m.forms.price),
});

/** Staff run the schedule of their sections. Writes go through the schedule RPC (service role) after the section check. */
export async function scheduleAction(_state: FormState, form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const { org } = manager;
  const parsed = schema.safeParse({
    sectionId: form.get("sectionId"),
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

  const section = await loadSection(createServiceClient(), { organizationId: org.id, sectionId: v.sectionId });
  if (!section || !manager.sectionIds.includes(section.id)) return { ok: false, errors: { sectionId: m.forms.choose } };

  const result = await scheduleOpenPlay(createServiceClient(), {
    organizationId: org.id,
    sectionId: section.id,
    activityId: v.activityId || null,
    resourceIds: v.resourceIds,
    first: { date: v.date, time: v.time },
    weeks: v.weeks,
    durationMin: v.durationMin,
    seatPricePoisha: bdtToPoisha(v.seatPrice)!,
    timeZone: org.timezone,
    openingHours: section.openingHours,
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

/** Cancel a game in a section this person runs (its seats are released and players told). */
export async function cancelSessionAction(sessionId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const section = await sectionOfSession(db, sessionId);
  if (!section || section.organizationId !== manager.org.id || !manager.sectionIds.includes(section.id)) return { ok: false, message: m.schedule.invalid };
  const result = await cancelOpenPlay(db, sessionId);
  refresh();
  return result === "cancelled" ? { ok: true, message: m.schedule.cancelled } : { ok: false, message: m.schedule.notOpen };
}
