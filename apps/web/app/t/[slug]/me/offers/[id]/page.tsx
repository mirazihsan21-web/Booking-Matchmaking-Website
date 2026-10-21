import { Suspense } from "react";
import { OfferCard, OfferGone, offerIsOpen } from "@/components/open-play/offer-card";
import { requireUser } from "@/lib/auth/dal";
import { findOffer } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getPlayer } from "@/lib/tenancy/player";
import { respondMyOfferAction } from "./actions";

/** A signed-in player's own seat offer (the in-app link from the bell). */
async function MyOffer({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  await requireUser(`/me/offers/${id}`);
  const player = await getPlayer(slug);
  if (!player) return null;
  const offer = player.profileId ? await findOffer(createServiceClient(), { offerId: id, profileId: player.profileId, organizationId: player.org.id }) : null;
  if (!offerIsOpen(offer)) return <OfferGone />;
  return (
    <OfferCard
      offer={offer}
      timeZone={player.org.timezone}
      accept={respondMyOfferAction.bind(null, slug, id, "accept")}
      decline={respondMyOfferAction.bind(null, slug, id, "decline")}
    />
  );
}

export default function MyOfferPage({ params }: PageProps<"/t/[slug]/me/offers/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <Suspense fallback={null}>
        <MyOffer params={params} />
      </Suspense>
    </main>
  );
}
