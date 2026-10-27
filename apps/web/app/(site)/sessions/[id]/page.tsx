import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { ActionButton } from "@/components/forms/action-form";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { SeatsBar } from "@/components/site/seats-bar";
import { sectionStyle } from "@/components/site/section-style";
import { buttonVariants } from "@/components/ui/button";
import { formatNight, formatShortTime } from "@/lib/format";
import { formatBdt } from "@/lib/money";
import { playerSessionView, seatCounts, type PlayerSessionView } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { sectionPath } from "@/lib/site/paths";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { cancelSeatAction } from "../../me/bookings/actions";
import { requestSeatAction, withdrawAction } from "./actions";

const primary = cn(buttonVariants({ variant: "section", size: "lg" }), "press self-start px-5");

/** What the visitor can do, one thing at a time: sign in, create a profile, rate, ask, withdraw, answer an offer or cancel. */
function Actions({ view, signedIn, hasProfile }: { view: PlayerSessionView; signedIn: boolean; hasProfile: boolean }) {
  const { session, me } = view;
  const live = (session.status === "open" || session.status === "matched") && new Date(session.startsAt) > new Date();
  if (!live) return <p className="text-muted-foreground">{session.status === "cancelled" ? m.openPlay.cancelledSession : m.openPlay.closed}</p>;
  if (!signedIn) {
    return (
      <Link href={`/signin?next=${encodeURIComponent(`/sessions/${session.id}`)}`} className={primary}>
        {m.openPlay.signInToJoin}
      </Link>
    );
  }
  if (!hasProfile || !me) {
    return (
      <Link href="/me" className={primary}>
        {m.openPlay.createProfile}
      </Link>
    );
  }
  switch (me.state) {
    case "none":
      if (me.needsRating) {
        return (
          <div className="flex flex-col items-start gap-3">
            <p>{m.openPlay.outcome.needs_skill}</p>
            <Link href="/me" className={primary}>
              {m.openPlay.rateLevel}
            </Link>
          </div>
        );
      }
      return (
        <ActionButton
          action={requestSeatAction.bind(null, session.id)}
          label={view.seatsLeft === 0 ? m.openPlay.joinWaitlist : m.openPlay.requestSeat}
          variant="section"
        />
      );
    case "requested":
    case "waitlisted":
      return (
        <div className="flex flex-col gap-3">
          <p>{me.state === "requested" ? m.openPlay.requested : m.openPlay.waitlisted(me.position ?? 1)}</p>
          <ActionButton action={withdrawAction.bind(null, session.id)} label={m.openPlay.withdraw} />
        </div>
      );
    case "offered":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-semibold">{m.openPlay.offered}</p>
          {me.offerId && (
            <Link href={`/me/offers/${me.offerId}`} className={primary}>
              {m.openPlay.seeOffer}
            </Link>
          )}
        </div>
      );
    case "seated":
      return (
        <div className="flex flex-col gap-3">
          <p className="font-display text-3xl uppercase tracking-wide text-section">{m.openPlay.seated}</p>
          {me.cancellable && me.bookingId ? (
            <ActionButton action={cancelSeatAction.bind(null, me.bookingId)} label={m.openPlay.cancelSeat} />
          ) : (
            <p className="text-sm text-muted-foreground">{m.openPlay.contactVenue}</p>
          )}
        </div>
      );
  }
}

/** The player's own group once seated: their space and who is on each team (display names only). */
function Group({ view }: { view: PlayerSessionView }) {
  const { group, me } = view;
  if (!group) return null;
  return (
    <section className="flex flex-col gap-3">
      <p className="text-muted-foreground">{m.openPlay.where(group.resourceName)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {group.teams.map(({ team, names }) => {
          const mine = team !== null && team === me?.team;
          return (
            <div key={team ?? "all"} className={cn("rounded-xl bg-card p-4", mine && "ring-2 ring-section")}>
              <p className="font-display text-xl uppercase tracking-wide">
                {team === null ? m.openPlay.players : m.openPlay.team(team)}
                {mine && <span className="ml-2 font-sans text-xs font-semibold normal-case text-section">{m.openPlay.yourTeam}</span>}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {names.map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const player = await getSitePlayer();
  const db = createServiceClient();
  const view = await playerSessionView(db, { organizationId: brand.id, sessionId: id, profileId: player?.profileId ?? null });
  if (!view) notFound();
  const { session } = view;
  const section = brand.sections.find((s) => s.id === session.sectionId);
  const counts = (await seatCounts(db, { organizationId: brand.id, sessionIds: [session.id] })).get(session.id) ?? { left: 0, total: 0 };
  const live = (session.status === "open" || session.status === "matched") && new Date(session.startsAt) > new Date();

  return (
    <main style={section ? sectionStyle(section.accent) : undefined} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <section className="rise flex flex-col gap-4 rounded-xl border-l-[3px] border-section bg-card p-5 sm:p-6">
        {section && (
          <Link href={sectionPath(section.slug)} className="font-display text-lg uppercase tracking-wide text-section hover:underline">
            {section.name}
          </Link>
        )}
        <h1 className="font-display text-4xl uppercase leading-none tracking-wide sm:text-5xl">{session.activityName ?? m.site.anyGame}</h1>
        <p className="text-muted-foreground">
          {formatNight(session.startsAt, brand.timezone)}–{formatShortTime(session.endsAt, brand.timezone)} · {m.site.perSeat(formatBdt(session.pricePoisha))}
        </p>
        {live && <SeatsBar left={counts.left} total={counts.total} />}
        <Actions view={view} signedIn={Boolean(player)} hasProfile={Boolean(player?.profileId)} />
      </section>
      <Group view={view} />
      <AutoRefresh />
    </main>
  );
}

export default function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  return (
    <Suspense fallback={null}>
      <SessionDetail params={params} />
    </Suspense>
  );
}
