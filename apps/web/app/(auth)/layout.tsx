import { Suspense, type ReactNode } from "react";
import { SiteChrome } from "@/components/site/site-chrome";
import { getBrand } from "@/lib/tenancy/brand";

async function Shell({ children }: { children: ReactNode }) {
  const brand = await getBrand();
  return brand ? <SiteChrome brand={brand}>{children}</SiteChrome> : children;
}

/**
 * Sign-in: inside the brand's navigation when the brand is live, plain otherwise. Unlike the public pages
 * it never shows "Not open yet" — staff must be able to sign in to set up or publish a brand that isn't live.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
