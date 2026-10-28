import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { SectionTabs } from "@/components/manage/section-tabs";
import { sectionStyle } from "@/components/site/section-style";
import { loadSections } from "@/lib/sections/sections";
import { findSection } from "@/lib/site/home";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";

async function Header({ params, children }: { params: Promise<{ section: string }>; children: ReactNode }) {
  const { section: slug } = await params;
  const { org } = await requireManager("owner");
  const section = findSection(await loadSections(createServiceClient(), org.id), slug);
  if (!section) notFound();
  return (
    <div style={sectionStyle(section.accent)} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/manage/sections" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← {m.manage.sectionsPage.all}
        </Link>
        <h1 className="font-display text-4xl uppercase tracking-wide text-section">{section.name}</h1>
      </div>
      <SectionTabs slug={section.slug} />
      {children}
    </div>
  );
}

/** One section's setup (owner only): its name in its colour and the tabs; an unknown section is a 404. */
export default function SectionLayout({ children, params }: LayoutProps<"/manage/sections/[section]">) {
  return (
    <Suspense fallback={null}>
      <Header params={params}>{children}</Header>
    </Suspense>
  );
}
