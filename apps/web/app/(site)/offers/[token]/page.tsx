import { Suspense } from "react";
import { OfferCard, OfferGone, offerIsOpen } from "@/components/open-play/offer-card";
import { findOffer } from "@/lib/open-play/open-play";
import { createServiceClient } from "@/lib/service-client";
import { getBrand } from "@/lib/tenancy/brand";
import { respondByTokenAction } from "./actions";

/** The page an offer email links to. No sign-in; opening it never accepts (the buttons are POSTs). */
async function TokenOffer({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const offer = await findOffer(createServiceClient(), { token });
  if (!offerIsOpen(offer) || offer.organizationSlug !== brand.slug) return <OfferGone />;
  return (
    <OfferCard
      offer={offer}
      timeZone={brand.timezone}
      accept={respondByTokenAction.bind(null, token, "accept")}
      decline={respondByTokenAction.bind(null, token, "decline")}
    />
  );
}

export default function TokenOfferPage({ params }: PageProps<"/offers/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <TokenOffer params={params} />
      </Suspense>
    </main>
  );
}
