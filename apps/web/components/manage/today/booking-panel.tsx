"use client";

import { useRef, useState, type ReactNode } from "react";
import { ActionButton, ActionForm, FieldError, type FormAction } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { amountInput, formatBdt } from "@/lib/money";
import { formatShortTime } from "@/lib/format";
import { m } from "@/messages";

export interface PanelBooking {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  start: string;
  end: string;
  pricePoisha: number;
  spaceName: string;
  paidPoisha: number | null;
  paymentId: string | null;
}

/** The desk's actions on one booking, bound on the server (each checks the person may run its section). */
export interface PanelActions {
  arrived: FormAction;
  noShow: FormAction;
  undo: FormAction;
  cancel: FormAction;
  pay: FormAction;
  voidPay: FormAction | null;
}

/**
 * A booking's panel: who, where, when, the price; Arrived / No-show (or Undo); Paid in cash (amount
 * editable; Undo payment once paid); and Cancel behind a confirmation that warns when cash was taken.
 * `children` is the button that opens it (a timeline block or a card's Details).
 */
export function BookingPanel({ booking, actions, timeZone, className, children }: { booking: PanelBooking; actions: PanelActions; timeZone: string; className?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const p = m.manage.panel;
  const desk = m.manage.desk;
  const time = `${formatShortTime(booking.start, timeZone)}–${formatShortTime(booking.end, timeZone)}`;
  const live = booking.status !== "cancelled";
  return (
    <>
      <button type="button" className={className} onClick={() => dialog.current?.showModal()}>
        {children}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setConfirming(false)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-2xl uppercase tracking-wide">{booking.name}</h2>
            <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold">{desk.status[booking.status] ?? booking.status}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{p.space}</dt>
            <dd>{booking.spaceName}</dd>
            <dt className="text-muted-foreground">{p.time}</dt>
            <dd>{time}</dd>
            {booking.phone && (
              <>
                <dt className="text-muted-foreground">{p.phone}</dt>
                <dd>
                  <a href={`tel:${booking.phone}`} className="underline underline-offset-4">
                    {booking.phone}
                  </a>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{p.price}</dt>
            <dd>{booking.pricePoisha > 0 ? formatBdt(booking.pricePoisha) : m.bookings.priceAtVenue}</dd>
          </dl>
          {booking.status === "confirmed" ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton action={actions.arrived} label={desk.arrived} variant="section" />
              <ActionButton action={actions.noShow} label={desk.noShow} />
            </div>
          ) : live ? (
            <ActionButton action={actions.undo} label={desk.undo} />
          ) : null}
          {live &&
            (booking.paidPoisha !== null && actions.voidPay ? (
              <div className="flex flex-col gap-2 rounded-lg bg-raised p-3">
                <p className="text-sm font-semibold">{desk.paidAmount(formatBdt(booking.paidPoisha))}</p>
                <ActionButton action={actions.voidPay} label={desk.undoPayment} />
              </div>
            ) : (
              <ActionForm action={actions.pay} submitLabel={desk.markPaid} variant="section" className="rounded-lg bg-raised p-3">
                {/* Its own id: every booking's panel is on the page at once. */}
                <label htmlFor={`amount-${booking.id}`} className="text-sm font-medium">
                  {desk.paidInCash} · {desk.amount}
                </label>
                <Input id={`amount-${booking.id}`} name="amount" inputMode="decimal" defaultValue={amountInput(booking.pricePoisha)} required />
                <FieldError name="amount" />
              </ActionForm>
            ))}
          {booking.status === "confirmed" &&
            (confirming ? (
              <div className="flex flex-col gap-2 rounded-lg bg-raised p-3">
                {booking.paidPoisha !== null && <p className="text-sm font-semibold text-warning">{desk.paidCancelWarning(formatBdt(booking.paidPoisha))}</p>}
                <p className="text-sm font-semibold">{p.cancelConfirm}</p>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={actions.cancel} label={p.yesCancel} variant="destructive" />
                  <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                    {p.keep}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="self-start" onClick={() => setConfirming(true)}>
                {p.cancelBooking}
              </Button>
            ))}
          <Button type="button" variant="outline" className="self-end" onClick={() => dialog.current?.close()}>
            {p.close}
          </Button>
        </div>
      </dialog>
    </>
  );
}
