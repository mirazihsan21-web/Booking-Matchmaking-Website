import { Suspense } from "react";
import { OfferCard, OfferGone, offerIsOpen } from "@/components/open-play/offer-card";
import { findOffer } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { respondByTokenAction } from "./actions";

/** The page an offer email links to. No sign-in; opening it never accepts (the buttons are POSTs). */
async function TokenOffer({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const org = await getLiveOrganization(slug);
  if (!org) return null; // the layout already shows "not available"
  const offer = await findOffer(createServiceClient(), { token });
  if (!offerIsOpen(offer) || offer.organizationSlug !== slug) return <OfferGone />;
  return (
    <OfferCard
      offer={offer}
      timeZone={org.timezone}
      accept={respondByTokenAction.bind(null, slug, token, "accept")}
      decline={respondByTokenAction.bind(null, slug, token, "decline")}
    />
  );
}

export default function TokenOfferPage({ params }: PageProps<"/t/[slug]/offers/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <Suspense fallback={null}>
        <TokenOffer params={params} />
      </Suspense>
    </main>
  );
}
