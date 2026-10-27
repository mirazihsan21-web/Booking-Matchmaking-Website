import { Suspense, type ReactNode } from "react";
import { NotOpen } from "@/components/site/not-open";
import { SiteChrome } from "@/components/site/site-chrome";
import { getBrand } from "@/lib/tenancy/brand";

async function Shell({ children }: { children: ReactNode }) {
  const brand = await getBrand();
  if (!brand) return <NotOpen />;
  return <SiteChrome brand={brand}>{children}</SiteChrome>;
}

/** Every public page: the brand's navigation around the page, or "Not open yet" while there's no live brand. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
