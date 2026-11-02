"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/components/forms/action-form";
import { mutePlayer, resolveReports, setBlockedWord, unmutePlayer } from "@/lib/chat/moderation";
import { parseBlockedWordForm, parseMuteForm, type ChatRefusal } from "@/lib/forms/chat";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

/** The team's chat work: every action is open to owners and staff (the database checks the team again). */
function outcome(result: string): FormState {
  refresh();
  const done = m.manage.chat.done[result];
  return done ? { ok: true, message: done } : { ok: false, message: m.chat.refusal[result as ChatRefusal] };
}

/** Remove the reported message, or dismiss its reports (a hidden message comes back). */
export async function resolveReportsAction(messageId: string, action: "remove" | "dismiss", _state: FormState, _form: FormData): Promise<FormState> {
  const { user } = await requireManager("staff");
  return outcome(await resolveReports(createServiceClient(), { messageId, userId: user.id, action }));
}

/** Mute a reported message's author for `length` ("1", "7" or "forever"). */
export async function muteFromReportAction(profileId: string, length: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org, user } = await requireManager("staff");
  const form = new FormData();
  form.set("profileId", profileId);
  form.set("length", length);
  const parsed = parseMuteForm(form);
  if (!parsed.ok) return { ok: false, message: m.chat.refusal.invalid };
  return outcome(await mutePlayer(createServiceClient(), { organizationId: org.id, userId: user.id, ...parsed.value }));
}

export async function unmuteAction(profileId: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org, user } = await requireManager("staff");
  return outcome(await unmutePlayer(createServiceClient(), { organizationId: org.id, userId: user.id, profileId }));
}

export async function addWordAction(_state: FormState, form: FormData): Promise<FormState> {
  const { org, user } = await requireManager("staff");
  const parsed = parseBlockedWordForm(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return outcome(await setBlockedWord(createServiceClient(), { organizationId: org.id, userId: user.id, word: parsed.value.word, add: true }));
}

export async function removeWordAction(word: string, _state: FormState, _form: FormData): Promise<FormState> {
  const { org, user } = await requireManager("staff");
  return outcome(await setBlockedWord(createServiceClient(), { organizationId: org.id, userId: user.id, word, add: false }));
}
