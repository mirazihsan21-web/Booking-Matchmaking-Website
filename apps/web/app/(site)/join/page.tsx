import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { requireUser } from "@/lib/auth/dal";
import { getSitePlayer } from "@/lib/tenancy/player";
import { getMyTeamInvite } from "@/lib/tenancy/team-invite";
import { m } from "@/messages";
import { declineTeamAction, joinTeamAction } from "./actions";

/**
 * An invite to the brand's team, for someone who already has an account (the bar on every page and our email
 * lead here): join, or say no. Signed out → sign in and come back; already on the team → Manage.
 */
async function Join() {
  await requireUser("/join");
  const player = await getSitePlayer();
  if (!player) return null; // the layout shows "Not open yet"
  if (player.isTeam) redirect("/manage");
  const invite = await getMyTeamInvite();
  const brandName = player.brand.name;

  if (!invite) {
    return (
      <section className="rise flex flex-col items-start gap-4 rounded-xl bg-card p-6">
        <p>{m.join.none(player.user.email ?? "")}</p>
        <Link href="/" className="text-sm font-semibold hover:underline">
          {m.join.home}
        </Link>
      </section>
    );
  }

  return (
    <section className="rise flex flex-col gap-4 rounded-xl bg-card p-6">
      <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{m.join.title(brandName)}</h1>
      <p className="text-lg">{m.join.invitation(brandName, invite.role, invite.sectionNames)}</p>
      <p className="text-muted-foreground">{m.join.teamLogin}</p>
      <div className="flex flex-wrap items-start gap-3">
        <ActionButton action={joinTeamAction} label={m.join.join} variant="default" />
        <ActionButton action={declineTeamAction} label={m.join.decline} variant="ghost" />
      </div>
    </section>
  );
}

export default function JoinPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Join />
      </Suspense>
    </main>
  );
}
