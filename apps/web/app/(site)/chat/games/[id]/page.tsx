import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cardLeft } from "@/components/chat/card-item";
import { ActionButton } from "@/components/forms/action-form";
import { AutoRefresh } from "@/components/site/auto-refresh";
import { sectionStyle } from "@/components/site/section-style";
import { cardView, type CardView } from "@/lib/chat/cards";
import { cardWhen, chatTime } from "@/lib/chat/time";
import { createServiceClient } from "@/lib/service-client";
import { getBrand } from "@/lib/tenancy/brand";
import { getSitePlayer } from "@/lib/tenancy/player";
import { m } from "@/messages";
import { acceptAction, closeCardAction, declineAction, leaveAction, removePlayerAction, requestAction, withdrawAction } from "./actions";

function Phone({ phone }: { phone: string | null }) {
  return phone ? (
    <a href={`tel:${phone}`} className="font-semibold underline">
      {phone}
    </a>
  ) : (
    <span className="text-muted-foreground">{m.chat.game.noNumber}</span>
  );
}

const AddYourNumber = () => (
  <Link href="/me/edit?next=/chat" className="text-sm underline">
    {m.chat.game.addYourNumber}
  </Link>
);

/** What the poster does: answer requests, see who's in (with their numbers), take someone off, close the card. */
function PosterPanel({ view, live, lineupOpen, myPhone, timeZone }: { view: CardView; live: boolean; lineupOpen: boolean; myPhone: string | null; timeZone: string }) {
  const { card } = view;
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">{m.chat.game.requestsTitle}</h2>
        {view.requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.chat.game.noRequests}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.requests.map((r) => (
              <li key={r.profileId} className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3">
                <span className="font-semibold">{r.name}</span>
                <span className="text-sm text-muted-foreground">
                  {[r.skill ? m.chat.game.level(r.skill) : null, chatTime(r.askedAt, timeZone, new Date())].filter(Boolean).join(" · ")}
                </span>
                {live && (
                  <span className="ml-auto flex gap-2">
                    <ActionButton action={acceptAction.bind(null, card.id, r.profileId)} label={m.chat.game.accept} variant="section" />
                    <ActionButton action={declineAction.bind(null, card.id, r.profileId)} label={m.chat.game.decline} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">{m.chat.game.acceptedTitle}</h2>
        {view.accepted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.chat.game.noneAccepted}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.accepted.map((p) => (
              <li key={p.profileId} className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3">
                <span className="font-semibold">{p.name}</span>
                <Phone phone={p.phone} />
                {lineupOpen && (
                  <span className="ml-auto">
                    <ActionButton action={removePlayerAction.bind(null, card.id, p.profileId)} label={m.chat.game.remove} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {view.accepted.length > 0 && !myPhone && <AddYourNumber />}
      </section>
      {live && <ActionButton action={closeCardAction.bind(null, card.id)} label={m.chat.game.close} />}
    </>
  );
}

/** Everyone else: an accepted player (the poster's number, Can't make it), someone waiting, or I'm in. */
function PlayerPanel({
  view,
  live,
  lineupOpen,
  signedIn,
  hasProfile,
  isTeam,
  myPhone,
}: {
  view: CardView;
  live: boolean;
  lineupOpen: boolean;
  signedIn: boolean;
  hasProfile: boolean;
  isTeam: boolean;
  myPhone: string | null;
}) {
  const { card } = view;
  if (card.kind === "session") {
    return live ? (
      <Link href={`/sessions/${card.sessionId}`} className="press self-start rounded-lg bg-section px-5 py-2.5 font-bold text-on-section">
        {m.chat.card.getSeat}
      </Link>
    ) : null;
  }
  if (view.role === "accepted") {
    return (
      <section className="flex flex-col gap-3 rounded-xl bg-card p-4">
        <p className="font-display text-3xl uppercase tracking-wide text-section">{m.chat.game.youreIn}</p>
        <p className="flex flex-wrap gap-2">
          <span>{m.chat.game.posterNumber(card.posterName)}</span>
          <Phone phone={view.posterPhone} />
        </p>
        {!myPhone && <AddYourNumber />}
        {lineupOpen && <ActionButton action={leaveAction.bind(null, card.id)} label={m.chat.game.cantMakeIt} />}
      </section>
    );
  }
  if (view.role === "waiting") {
    return (
      <section className="flex flex-col items-start gap-3">
        <p className="font-semibold">{m.chat.game.waitingFor(card.posterName)}</p>
        <ActionButton action={withdrawAction.bind(null, card.id)} label={m.chat.game.withdraw} />
      </section>
    );
  }
  if (isTeam) {
    return (
      <section className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{m.chat.game.teamNote}</p>
        {live && <ActionButton action={closeCardAction.bind(null, card.id)} label={m.chat.game.close} />}
      </section>
    );
  }
  const answer = view.myStatus ? m.chat.game.answer[view.myStatus] : undefined;
  if (answer) return <p className="text-muted-foreground">{answer}</p>;
  if (!live) return null;
  if (!signedIn) {
    return (
      <Link href={`/signin?next=${encodeURIComponent(`/chat/games/${card.id}`)}`} className="press self-start rounded-lg bg-section px-5 py-2.5 font-bold text-on-section">
        {m.chat.game.signInToJoin}
      </Link>
    );
  }
  if (!hasProfile) {
    return (
      <Link href={`/me/edit?next=${encodeURIComponent(`/chat/games/${card.id}`)}`} className="font-semibold underline">
        {m.chat.game.createProfile}
      </Link>
    );
  }
  return <ActionButton action={requestAction.bind(null, card.id)} label={m.chat.card.imIn} variant="section" />;
}

async function Game({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const player = await getSitePlayer();
  if (!player) {
    // The chat is for signed-in people only, its game pages too.
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
        <section className="flex flex-col items-start gap-3 rounded-xl bg-card p-6">
          <p className="text-lg font-semibold">{m.chat.signInToSee}</p>
          <Link href={`/signin?next=${encodeURIComponent(`/chat/games/${id}`)}`} className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground">
            {m.chat.signIn}
          </Link>
        </section>
      </main>
    );
  }
  const db = createServiceClient();
  const view = await cardView(db, {
    organizationId: brand.id,
    cardId: id,
    viewer: { userId: player.user.id, profileId: player.profileId, isTeam: player.isTeam },
  });
  if (!view) notFound();
  const { card } = view;
  const ahead = new Date(card.startsAt) > new Date();
  const live = (card.status === "open" || card.status === "full") && ahead;
  // Even after the poster closes the card, who's in can change until the game starts.
  const lineupOpen = (live || card.status === "closed") && ahead;
  const myPhone =
    player.profileId && (view.role === "poster" || view.role === "accepted")
      ? (((await db.from("player_profiles").select("phone").eq("id", player.profileId).maybeSingle()).data?.phone as string | null) ?? null)
      : null;

  return (
    <main style={sectionStyle(card.sectionAccent)} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/chat" className="self-start text-sm text-muted-foreground hover:underline">
        ← {m.chat.game.back}
      </Link>
      <section className="rise flex flex-col gap-2 rounded-xl border-l-[3px] border-section bg-card p-5 sm:p-6">
        <p className="font-display text-lg uppercase tracking-wide text-section">
          {card.sectionName} · {card.kind === "booking" ? m.chat.card.needPlayers(card.spotsNeeded ?? 0) : m.chat.card.openPlay}
        </p>
        <h1 className="font-display text-4xl uppercase leading-none tracking-wide sm:text-5xl">{card.title}</h1>
        <p className="text-muted-foreground">
          {cardWhen(card, brand.timezone)} · {m.chat.card.postedBy(card.posterName)}
        </p>
        {card.note && <p className="whitespace-pre-wrap break-words">{card.note}</p>}
        <p className="font-semibold text-section">{cardLeft(card, null)}</p>
      </section>
      {view.role === "poster" && card.kind === "booking" ? (
        <PosterPanel view={view} live={live} lineupOpen={lineupOpen} myPhone={myPhone} timeZone={brand.timezone} />
      ) : (
        <PlayerPanel view={view} live={live} lineupOpen={lineupOpen} signedIn hasProfile={Boolean(player.profileId)} isTeam={player.isTeam} myPhone={myPhone} />
      )}
      <AutoRefresh seconds={20} />
    </main>
  );
}

export default function ChatGamePage({ params }: PageProps<"/chat/games/[id]">) {
  return (
    <Suspense fallback={null}>
      <Game params={params} />
    </Suspense>
  );
}
