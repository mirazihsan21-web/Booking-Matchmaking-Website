import { Suspense } from "react";
import { LegalPage } from "@/components/site/legal-page";
import { contactEmail } from "@/lib/site/contact";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";

async function Privacy() {
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  return (
    <LegalPage
      title={m.legal.privacy.title}
      intro={m.legal.privacy.intro(brand.name)}
      sections={m.legal.privacy.sections}
      contact={{ email: contactEmail(process.env.EMAIL_FROM), address: brand.address }}
    />
  );
}

/** The privacy policy: what the site keeps, why, where, and how to get a copy or have it deleted. */
export default function PrivacyPage() {
  return (
    <Suspense fallback={null}>
      <Privacy />
    </Suspense>
  );
}
