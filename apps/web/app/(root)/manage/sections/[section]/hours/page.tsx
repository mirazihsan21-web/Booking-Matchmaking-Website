import { Suspense } from "react";
import { ActionForm } from "@/components/forms/action-form";
import { SectionFields } from "@/components/manage/section-fields";
import { m } from "@/messages";
import { saveSectionAction } from "../../actions";
import { ownerSection } from "../owner-section";

/** A section's name, opening hours per weekday, booking rules and how long a seat offer waits. */
async function Hours({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await ownerSection(params);
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 sm:p-5">
      <h2 className="font-display text-2xl uppercase tracking-wide">{m.manage.openingHours}</h2>
      <ActionForm action={saveSectionAction.bind(null, section.id)} submitLabel={m.manage.save} className="gap-5">
        <SectionFields section={section} />
      </ActionForm>
    </section>
  );
}

export default function HoursPage({ params }: PageProps<"/manage/sections/[section]/hours">) {
  return (
    <Suspense fallback={null}>
      <Hours params={params} />
    </Suspense>
  );
}
