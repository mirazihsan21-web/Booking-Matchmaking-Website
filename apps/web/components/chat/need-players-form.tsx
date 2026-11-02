"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { postCardAction } from "@/app/(site)/chat/actions";
import { cardWhen } from "@/lib/chat/time";
import { formatNight } from "@/lib/format";
import { m } from "@/messages";

export interface CardableBooking {
  bookingId: string;
  label: string;
  startsAt: string;
  endsAt: string;
  maxSpots: number;
}

export interface ShareableSession {
  sessionId: string;
  label: string;
  startsAt: string;
}

/**
 * "Need players": pick one of your upcoming bookings (how many you're short, up to what the space holds) or an
 * open-play game you're going to, add a note, post. The team sees only games, as "Share a game".
 */
export function NeedPlayersForm({
  bookings,
  sessions,
  isTeam,
  timeZone,
}: {
  bookings: CardableBooking[];
  sessions: ShareableSession[];
  isTeam: boolean;
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    ...bookings.map((b) => ({ value: `booking:${b.bookingId}`, label: `${b.label} · ${cardWhen(b, timeZone)}`, max: b.maxSpots })),
    ...sessions.map((s) => ({ value: `session:${s.sessionId}`, label: `${s.label} · ${formatNight(s.startsAt, timeZone)}`, max: null })),
  ];
  const [target, setTarget] = useState(options[0]?.value ?? "");
  const chosen = options.find((o) => o.value === target) ?? options[0];

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="self-start">
        {isTeam ? m.chat.shareGame : m.chat.needPlayers}
      </Button>
      {open &&
        (options.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-xl bg-card p-4 text-sm">
            <p>{isTeam ? m.chat.form.teamNothing : m.chat.form.needBookingFirst}</p>
            {!isTeam && (
              <Link href="/" className="font-semibold underline">
                {m.chat.form.bookSpace}
              </Link>
            )}
          </div>
        ) : (
          <ActionForm action={postCardAction} submitLabel={m.chat.form.post} resetOnSuccess className="rounded-xl bg-card p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target">{m.chat.form.target}</Label>
              <select
                id="target"
                name="target"
                value={chosen?.value}
                onChange={(event) => setTarget(event.target.value)}
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {chosen?.max != null && (
              <div className="flex flex-col gap-1">
                <Field name="spots" label={m.chat.form.spots} type="number" min={1} max={chosen.max} defaultValue={1} inputMode="numeric" className="w-24" />
                <p className="text-xs text-muted-foreground">{m.chat.form.spotsHint(chosen.max)}</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">{m.chat.form.note}</Label>
              <textarea id="note" name="note" rows={2} maxLength={400} placeholder={m.chat.form.notePlaceholder} className="rounded-lg border border-input bg-transparent px-3 py-2 text-sm" />
            </div>
          </ActionForm>
        ))}
    </div>
  );
}
