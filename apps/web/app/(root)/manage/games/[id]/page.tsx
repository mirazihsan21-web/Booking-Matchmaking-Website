import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { ActionButton, ActionForm } from "@/components/forms/action-form";
import { ConfirmAction } from "@/components/manage/confirm-action";
import { sectionStyle } from "@/components/site/section-style";
import { formatNight, formatShortTime } from "@/lib/format";
import { cancelQuestion } from "@/lib/manage/cancel";
import { amountInput, formatBdt } from "@/lib/money";
import { staffSessionView } from "@/lib/open-play/open-play";
import { livePayments } from "@/lib/payments/payments";
import { sectionOfSession } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManagedSection } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { recordPaymentAction, setDeskStatusAction, voidPaymentAction } from "../../desk-actions";
import { cancelSessionAction } from "../../schedule/actions";
import { matchNowAction, staffCancelSeatAction } from "./actions";

/**
 * One game for the desk: requests and Match now while open; once matched, the teams with each player's
 * Arrived / No-show (or Undo), Paid in cash and Cancel seat; the waitlist and live offers.
 */
async function Game({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServiceClient();
  const section = await sectionOfSession(db, id);
  if (!section) notFound();
  const manager = await requireManagedSection(section.id);
  const view = await staffSessionView(db, { organizationId: manager.org.id, sessionId: id });
  if (!view) notFound();
  const { session } = view;
  const tz = manager.org.timezone;
  const live = (session.status === "open" || session.status === "matched") && new Date(session.startsAt) > new Date();
  const playing = session.status === "open" || session.status === "matched" || session.status === "closed";
  const t = m.staffSession;
  const desk = m.manage.desk;

  const seatIds = view.groups.flatMap((g) => g.teams.flatMap((team) => team.players.map((p) => p.bookingId)));
  const [{ data: seats }, payments] = await Promise.all([
    seatIds.length ? db.from("bookings").select("id, status, price_poisha").in("id", seatIds) : Promise.resolve({ data: [] as Array<{ id: string; status: string; price_poisha: number }> }),
    livePayments(db, { spaceBookingIds: [], seatBookingIds: seatIds }),
  ]);
  const paidSeats = { count: payments.size, poisha: [...payments.values()].reduce((sum, p) => sum + p.amountPoisha, 0) };
  const seatOf = new Map((seats ?? []).map((s) => [s.id as string, { status: s.status as string, price: s.price_poisha as number }]));

  return (
    <div style={sectionStyle(section.accent)} className="flex flex-col gap-6">
      <Link href="/manage/schedule" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        {t.back}
      </Link>
      <section className="flex flex-col gap-3 rounded-xl border-l-[3px] border-section bg-card p-5">
        <p className="font-display text-lg uppercase tracking-wide text-section">{section.name}</p>
        <h1 className="font-display text-4xl uppercase leading-none tracking-wide">{session.activityName ?? m.schedule.playersChoose}</h1>
        <p className="text-muted-foreground">
          {formatNight(session.startsAt, tz)}–{formatShortTime(session.endsAt, tz)} · {m.site.perSeat(formatBdt(session.pricePoisha))}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-semibold">{t.status[session.status] ?? session.status}</span>
          {live && (
            <ConfirmAction
              action={cancelSessionAction.bind(null, session.id)}
              label={t.cancelSession}
              question={cancelQuestion("game", paidSeats)}
              confirmLabel={m.manage.panel.yesCancel}
              cancelLabel={m.manage.panel.keep}
            />
          )}
        </div>
      </section>

      {session.status === "open" && (
        <section className="flex flex-col gap-3 rounded-xl bg-card p-5">
          <h2 className="font-display text-2xl uppercase tracking-wide">{t.requests(view.requests.length)}</h2>
          {view.notEnoughPlayers && view.needed !== null && <p className="text-sm text-warning">{t.notEnough(view.requests.length, view.needed)}</p>}
          {view.requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noRequests}</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {view.requests.map((r) => (
                <li key={r.profileId} className="rounded-full bg-raised px-3 py-1">
                  {r.name} <span className="text-muted-foreground">· {t.skill(r.skill)}</span>
                </li>
              ))}
            </ul>
          )}
          {live && <ActionButton action={matchNowAction.bind(null, session.id)} label={t.matchNow} variant="section" />}
        </section>
      )}

      {view.groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl uppercase tracking-wide">{t.groups}</h2>
          {view.groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-3 rounded-xl bg-card p-5">
              <h3 className="font-semibold">
                {g.resourceName} · {g.activityName}
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {g.teams.map((team) => (
                  <div key={team.team ?? "all"} className="flex flex-col gap-2">
                    <h4 className="font-display text-lg uppercase tracking-wide">
                      {team.team === null ? t.players : t.team(team.team)}{" "}
                      <span className="font-sans text-xs font-normal normal-case text-muted-foreground">· {t.skillTotal(team.skillTotal)}</span>
                    </h4>
                    <ul className="flex flex-col gap-2 text-sm">
                      {team.players.map((p) => {
                        const seat = seatOf.get(p.bookingId);
                        const status = seat?.status ?? "confirmed";
                        const paid = payments.get(p.bookingId);
                        return (
                          <li key={p.bookingId} className="flex flex-col gap-2 rounded-lg bg-raised px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{p.name}</span>
                              <span className="text-muted-foreground">· {t.skill(p.skill)}</span>
                              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", status === "confirmed" ? "bg-card" : "bg-section text-on-section")}>
                                {desk.status[status] ?? status}
                              </span>
                              {paid && <span className="rounded-full bg-card px-2 py-0.5 text-xs">{desk.paidAmount(formatBdt(paid.amountPoisha))}</span>}
                            </div>
                            {playing && status !== "cancelled" && (
                              <div className="flex flex-wrap gap-2">
                                {status === "confirmed" ? (
                                  <>
                                    <ActionButton action={setDeskStatusAction.bind(null, "seat", p.bookingId, "attended")} label={desk.arrived} variant="section" />
                                    <ActionButton action={setDeskStatusAction.bind(null, "seat", p.bookingId, "no_show")} label={desk.noShow} />
                                  </>
                                ) : (
                                  <ActionButton action={setDeskStatusAction.bind(null, "seat", p.bookingId, "confirmed")} label={desk.undo} />
                                )}
                                {paid ? (
                                  <ActionButton action={voidPaymentAction.bind(null, paid.id)} label={desk.undoPayment} variant="ghost" />
                                ) : (
                                  <ActionForm action={recordPaymentAction.bind(null, "seat", p.bookingId)} submitLabel={`${desk.paid} ${formatBdt(seat?.price ?? session.pricePoisha)}`} className="flex-row">
                                    <input type="hidden" name="amount" value={amountInput(seat?.price ?? session.pricePoisha)} />
                                  </ActionForm>
                                )}
                                {live && (
                                  <ConfirmAction
                                    action={staffCancelSeatAction.bind(null, p.bookingId)}
                                    label={t.cancelSeat}
                                    question={cancelQuestion("seat", paid ? { count: 1, poisha: paid.amountPoisha } : { count: 0, poisha: 0 })}
                                    confirmLabel={m.manage.panel.yesCancel}
                                    cancelLabel={m.manage.panel.keep}
                                  />
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {session.status !== "open" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-2 rounded-xl bg-card p-5">
            <h2 className="font-display text-xl uppercase tracking-wide">{t.waitlist}</h2>
            {view.waitlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noWaitlist}</p>
            ) : (
              <ol className="flex flex-col gap-1 text-sm">
                {view.waitlist.map((w) => (
                  <li key={w.position}>
                    {w.position}. {w.name} <span className="text-muted-foreground">· {t.waitingStatus[w.status] ?? w.status}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="flex flex-col gap-2 rounded-xl bg-card p-5">
            <h2 className="font-display text-xl uppercase tracking-wide">{t.offers}</h2>
            {view.offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {view.offers.map((o) => (
                  <li key={`${o.resourceName}-${o.seatNo}`}>
                    {t.offer(o.name, o.resourceName, o.seatNo)} <span className="text-muted-foreground">· {t.ends(formatShortTime(o.expiresAt, tz))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function GamePage({ params }: PageProps<"/manage/games/[id]">) {
  return (
    <Suspense fallback={null}>
      <Game params={params} />
    </Suspense>
  );
}
