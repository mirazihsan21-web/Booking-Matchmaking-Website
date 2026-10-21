import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { playerSessionView, type PlayerSessionView } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { getPlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { cancelSeatAction } from "../../me/bookings/actions";
import { requestSeatAction, withdrawAction } from "./actions";

const button = "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90";

/** What the visitor can do: sign in, create a profile, ask, withdraw, answer an offer or cancel. */
function Actions({ view, slug, signedIn, hasProfile }: { view: PlayerSessionView; slug: string; signedIn: boolean; hasProfile: boolean }) {
  const { session, me } = view;
  const live = (session.status === "open" || session.status === "matched") && new Date(session.startsAt) > new Date();
  if (!live) return <p className="text-foreground/70">{session.status === "cancelled" ? m.openPlay.cancelledSession : m.openPlay.closed}</p>;
  if (!signedIn) {
    return (
      <Link href={`/signin?next=${encodeURIComponent(`/sessions/${session.id}`)}`} className={button}>
        {m.openPlay.signInToJoin}
      </Link>
    );
  }
  if (!hasProfile || !me) {
    return (
      <Link href="/me" className={button}>
        {m.openPlay.createProfile}
      </Link>
    );
  }
  switch (me.state) {
    case "none":
      return (
        <ActionButton
          action={requestSeatAction.bind(null, slug, session.id)}
          label={session.status === "matched" && view.seatsLeft === 0 ? m.openPlay.joinWaitlist : m.openPlay.requestSeat}
          variant="default"
        />
      );
    case "requested":
    case "waitlisted":
      return (
        <div className="flex flex-col gap-3">
          <p>{me.state === "requested" ? m.openPlay.requested : m.openPlay.waitlisted(me.position ?? 1)}</p>
          <ActionButton action={withdrawAction.bind(null, slug, session.id)} label={m.openPlay.withdraw} />
        </div>
      );
    case "offered":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-medium">{m.openPlay.offered}</p>
          {me.offerId && (
            <Link href={`/me/offers/${me.offerId}`} className={button}>
              {m.openPlay.seeOffer}
            </Link>
          )}
        </div>
      );
    case "seated":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-lg font-semibold text-primary">{m.openPlay.seated}</p>
          {me.cancellable && me.bookingId ? (
            <ActionButton action={cancelSeatAction.bind(null, slug, me.bookingId)} label={m.openPlay.cancelSeat} />
          ) : (
            <p className="text-sm text-foreground/60">{m.openPlay.contactVenue}</p>
          )}
        </div>
      );
  }
}

/** The player's own group: their space, and who is on each team (display names only). */
function Group({ view }: { view: PlayerSessionView }) {
  const { group, me } = view;
  if (!group) return null;
  return (
    <section className="flex flex-col gap-3">
      <p>{m.openPlay.where(group.resourceName)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {group.teams.map(({ team, names }) => (
          <Card key={team ?? "all"} className={team !== null && team === me?.team ? "border-primary" : undefined}>
            <CardHeader>
              <CardTitle>
                {team === null ? m.openPlay.players : m.openPlay.team(team)}
                {team !== null && team === me?.team && <span className="font-normal text-foreground/60"> · {m.openPlay.yourTeam}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {names.map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

async function SessionDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getLiveOrganization(slug);
  if (!org) return null; // the layout already shows "not available"
  const player = await getPlayer(slug);
  const view = await playerSessionView(createServiceClient(), { organizationId: org.id, sessionId: id, profileId: player?.profileId ?? null });
  if (!view) notFound();
  const { session } = view;
  const live = (session.status === "open" || session.status === "matched") && new Date(session.startsAt) > new Date();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{session.activityName ?? m.tenant.anyActivity}</CardTitle>
          <CardDescription>
            {formatNight(session.startsAt, org.timezone)}–{formatShortTime(session.endsAt, org.timezone)} · {session.branchName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{m.openPlay.perSeat(formatBdt(session.pricePoisha))}</Badge>
            {live && <Badge variant="outline">{view.seatsLeft > 0 ? m.openPlay.seatsLeft(view.seatsLeft) : m.openPlay.full}</Badge>}
          </div>
          <Actions view={view} slug={slug} signedIn={Boolean(player)} hasProfile={Boolean(player?.profileId)} />
        </CardContent>
      </Card>
      <Group view={view} />
    </div>
  );
}

export default function SessionPage({ params }: PageProps<"/t/[slug]/sessions/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <Suspense fallback={null}>
        <SessionDetail params={params} />
      </Suspense>
    </main>
  );
}
