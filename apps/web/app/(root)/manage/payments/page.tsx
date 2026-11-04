import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { RejectPayment } from "@/components/manage/reject-payment";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { claimsToCheck, holdsWaiting } from "@/lib/payments/claims";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { decideClaimAction } from "./actions";

/**
 * Payments to check: players who booked a priced space online and sent their bKash/Nagad details, oldest first, in
 * the sections this person runs — who, what, when, how much, from which number, the transaction ID — with Confirm
 * and Reject. Under it, requests still inside their 15 minutes (the player hasn't paid yet), so it's clear why
 * those slots are taken.
 */
async function Payments() {
  const manager = await requireManager("staff");
  const db = createServiceClient();
  const input = { organizationId: manager.org.id, sectionIds: manager.sectionIds };
  const [claims, holds] = await Promise.all([claimsToCheck(db, input), holdsWaiting(db, input)]);
  const tz = manager.org.timezone;
  const t = m.manage.payments;
  const now = new Date().getTime();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl uppercase tracking-wide">{t.title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      </div>

      {claims.length === 0 ? (
        <p className="text-muted-foreground">{t.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {claims.map((c) => (
            <li key={c.bookingId} className="flex flex-col gap-3 rounded-xl bg-card p-4 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold">{c.playerName}</span>
                {c.playerPhone && (
                  <a href={`tel:${c.playerPhone}`} className="text-muted-foreground underline-offset-4 hover:underline">
                    {c.playerPhone}
                  </a>
                )}
                <span>
                  {c.resourceName} · {c.sectionName}
                </span>
                <span>
                  {formatNight(c.start.toISOString(), tz)}–{formatShortTime(c.end.toISOString(), tz)}
                </span>
                {c.started && <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-warning">{t.started}</span>}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-2xl">{t.paidBy(formatBdt(c.amountPoisha), m.payments[c.method])}</span>
                <span>{t.from(c.senderPhone)}</span>
                <span className="font-mono">{t.trx(c.trxId)}</span>
                <span className="text-muted-foreground">{t.sentAt(formatShortTime(c.submittedAt.toISOString(), tz))}</span>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <ActionButton action={decideClaimAction.bind(null, c.bookingId, "confirm")} label={t.confirm} variant="section" />
                <RejectPayment action={decideClaimAction.bind(null, c.bookingId, "reject")} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {holds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-xl uppercase tracking-wide text-muted-foreground">{t.waitingTitle}</h2>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {holds.map((h) => (
              <li key={h.bookingId}>
                {h.playerName} · {h.resourceName} · {formatNight(h.start.toISOString(), tz)} · {t.minutesLeft(Math.ceil((h.holdUntil.getTime() - now) / 60_000))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={null}>
      <Payments />
    </Suspense>
  );
}
