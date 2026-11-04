import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { HoldCountdown } from "@/components/bookings/hold-countdown";
import { PayForm, PayNumber } from "@/components/bookings/pay-form";
import { ActionButton } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { payBooking } from "@/lib/payments/claims";
import { createServiceClient } from "@/lib/service-client";
import { bookPath } from "@/lib/site/paths";
import { requirePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { cancelHoldAction, submitClaimAction } from "./actions";

/**
 * Paying for a booking request by bKash or Nagad: while it's held (15 minutes) — the price, the venue's numbers,
 * "Use Send Money", the countdown and the form; then where it stands (sent, booked, not confirmed, ended).
 */
async function Pay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await requirePlayer(`/me/bookings/${id}/pay`);
  if (!player) return null; // the layout shows "Not open yet"
  if (!player.profileId) redirect("/me/edit");
  const view = await payBooking(createServiceClient(), { bookingId: id, profileId: player.profileId });
  if (!view) notFound();
  const { brand } = player;
  const section = brand.sections.find((s) => s.id === view.sectionId);
  const bookHref = section ? bookPath(section.slug, { resource: view.resourceId }) : "/";
  const when = `${formatNight(view.start.toISOString(), brand.timezone)}–${formatShortTime(view.end.toISOString(), brand.timezone)}`;
  const methods = (["bkash", "nagad"] as const).filter((method) => view.numbers[method]);
  const contact = view.numbers.bkash ?? view.numbers.nagad;
  const t = m.payments;

  return (
    <div style={section ? sectionStyle(section.accent) : undefined} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {section && <span className="font-display text-xl uppercase tracking-wide text-section">{section.name}</span>}
        <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{t.payTitle}</h1>
        <p className="text-muted-foreground">
          {view.resourceName} · {when}
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-card p-5 sm:p-6">
        <p className="font-display text-4xl">{formatBdt(view.amountPoisha)}</p>

        {view.status === "hold" && methods.length > 0 && (
          <>
            <ul className="flex flex-col gap-2">
              {methods.map((method) => (
                <PayNumber key={method} method={method} number={view.numbers[method]!} />
              ))}
            </ul>
            <p>{t.useSendMoney}</p>
            <HoldCountdown until={view.holdUntil!.toISOString()} bookHref={bookHref} />
            <PayForm action={submitClaimAction.bind(null, view.bookingId)} methods={methods} />
          </>
        )}
        {view.status === "hold" && methods.length === 0 && <p className="font-semibold">{t.contactToPay}</p>}
        {view.status === "hold" && <ActionButton action={cancelHoldAction.bind(null, view.bookingId)} label={t.cancelRequest} variant="ghost" />}

        {view.status === "sent" && <p className="font-semibold">{t.sentWaiting}</p>}
        {view.status === "confirmed" && <p className="font-semibold">{m.bookings.booked}</p>}
        {view.status === "rejected" && (
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{m.notifications.paymentRejected}</p>
            {view.rejectReason && <p>“{view.rejectReason}”</p>}
            <p>{contact ? m.notifications.contactUsOn(contact) : m.notifications.contactTheVenue}</p>
          </div>
        )}
        {view.status === "ended" && (
          <p role="status" className="font-semibold">
            {t.holdEnded}{" "}
            <Link href={bookHref} className="underline">
              {t.bookAgain}
            </Link>
          </p>
        )}
      </section>

      <Link href="/me/bookings" className="self-start text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← {m.bookings.mine}
      </Link>
    </div>
  );
}

export default function PayPage({ params }: PageProps<"/me/bookings/[id]/pay">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Pay params={params} />
      </Suspense>
    </main>
  );
}
