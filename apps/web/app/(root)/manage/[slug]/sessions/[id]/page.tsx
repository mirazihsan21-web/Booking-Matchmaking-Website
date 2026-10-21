import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { staffSessionView } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { cancelSessionAction } from "../../schedule/actions";
import { matchNowAction, staffCancelSeatAction } from "./actions";

/** One open-play session for staff: requests, Match now, the teams, the waitlist and live offers. */
async function StaffSession({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { org } = await requireOrgRole(slug, "staff");
  const view = await staffSessionView(createServiceClient(), { organizationId: org.id, sessionId: id });
  if (!view) notFound();
  const { session } = view;
  const tz = org.timezone;
  const live = (session.status === "open" || session.status === "matched") && new Date(session.startsAt) > new Date();
  const t = m.staffSession;

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/manage/${org.slug}/schedule`} className="text-sm text-primary hover:underline">
        {t.back}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{session.activityName ?? m.schedule.playersChoose}</CardTitle>
          <CardDescription>
            {formatNight(session.startsAt, tz)}–{formatShortTime(session.endsAt, tz)} · {session.branchName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge>{t.status[session.status] ?? session.status}</Badge>
          <Badge variant="outline">{formatBdt(session.pricePoisha)}</Badge>
          {live && <ActionButton action={cancelSessionAction.bind(null, org.slug, session.id)} label={t.cancelSession} variant="destructive" />}
        </CardContent>
      </Card>

      {session.status === "open" && (
        <Card>
          <CardHeader>
            <CardTitle>{t.requests(view.requests.length)}</CardTitle>
            {view.notEnoughPlayers && view.needed !== null && <CardDescription className="text-destructive">{t.notEnough(view.requests.length, view.needed)}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {view.requests.length === 0 ? (
              <p className="text-sm text-foreground/60">{t.noRequests}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {view.requests.map((r) => (
                  <li key={r.profileId} className="rounded-md border border-border px-2 py-1">
                    {r.name} <span className="text-foreground/50">· {t.skill(r.skill)}</span>
                  </li>
                ))}
              </ul>
            )}
            {live && <ActionButton action={matchNowAction.bind(null, org.slug, session.id)} label={t.matchNow} variant="default" />}
          </CardContent>
        </Card>
      )}

      {view.groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.groups}</h2>
          {view.groups.map((g) => (
            <Card key={g.id}>
              <CardHeader>
                <CardTitle>
                  {g.resourceName} · {g.activityName}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {g.teams.map((team) => (
                  <div key={team.team ?? "all"} className="flex flex-col gap-2">
                    <h3 className="font-medium">
                      {team.team === null ? t.players : t.team(team.team)} <span className="font-normal text-foreground/60">· {t.skillTotal(team.skillTotal)}</span>
                    </h3>
                    <ul className="flex flex-col gap-1 text-sm">
                      {team.players.map((p) => (
                        <li key={p.bookingId} className="flex items-center gap-2">
                          <span>
                            {p.name} <span className="text-foreground/50">· {t.skill(p.skill)}</span>
                          </span>
                          {live && <ActionButton action={staffCancelSeatAction.bind(null, org.slug, p.bookingId)} label={t.cancelSeat} variant="ghost" />}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {session.status !== "open" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.waitlist}</CardTitle>
            </CardHeader>
            <CardContent>
              {view.waitlist.length === 0 ? (
                <p className="text-sm text-foreground/60">{t.noWaitlist}</p>
              ) : (
                <ol className="flex flex-col gap-1 text-sm">
                  {view.waitlist.map((w) => (
                    <li key={w.position}>
                      {w.position}. {w.name} <span className="text-foreground/50">· {t.waitingStatus[w.status] ?? w.status}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t.offers}</CardTitle>
            </CardHeader>
            <CardContent>
              {view.offers.length === 0 ? (
                <p className="text-sm text-foreground/60">—</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {view.offers.map((o) => (
                    <li key={`${o.resourceName}-${o.seatNo}`}>
                      {t.offer(o.name, o.resourceName, o.seatNo)} <span className="text-foreground/50">· {t.ends(formatShortTime(o.expiresAt, tz))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function StaffSessionPage({ params }: PageProps<"/manage/[slug]/sessions/[id]">) {
  return (
    <Suspense fallback={null}>
      <StaffSession params={params} />
    </Suspense>
  );
}
