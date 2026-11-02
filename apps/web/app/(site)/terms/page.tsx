import { Suspense } from "react";
import { LegalPage } from "@/components/site/legal-page";
import { contactEmail } from "@/lib/site/contact";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

async function Terms() {
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  return (
    <LegalPage
      title={m.legal.terms.title}
      intro={m.legal.terms.intro(brand.name, brand.address)}
      sections={m.legal.terms.sections}
      contact={{ email: contactEmail(process.env.EMAIL_FROM), address: brand.address }}
    />
  );
}

/** The terms of use: accounts, booking, cancelling, open play, fair play, and the site itself. */
export default function TermsPage() {
  return (
    <Suspense fallback={null}>
      <Terms />
    </Suspense>
  );
}
