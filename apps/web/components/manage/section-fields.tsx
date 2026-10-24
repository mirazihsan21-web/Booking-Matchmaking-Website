import { Field } from "@/components/forms/action-form";
import { OpeningHoursEditor } from "@/components/manage/opening-hours-editor";
import type { Section } from "@/lib/sections/sections";
import { m } from "@/messages";

/** A section's name, opening hours and booking rules (parsed by parseSectionForm). */
export function SectionFields({ section }: { section: Section }) {
  const { rules } = section;
  return (
    <>
      <Field name="name" label={m.manage.name} defaultValue={section.name} required />
      <OpeningHoursEditor value={section.openingHours} />
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium">{m.manage.sectionRules}</p>
          <p className="text-sm text-foreground/60">{m.manage.sectionRulesIntro}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <Field name="horizonDays" label={m.manage.horizonDays} type="number" min={1} max={90} defaultValue={rules.bookingHorizonDays} />
          <Field name="maxUpcoming" label={m.manage.maxUpcoming} type="number" min={1} max={20} defaultValue={rules.maxUpcomingBookings} />
          <Field name="cancelCutoffHours" label={m.manage.cancelCutoffHours} type="number" min={0} max={168} defaultValue={rules.cancelCutoffMinutes / 60} />
          <Field name="matchCutoffHours" label={m.manage.matchCutoffHours} type="number" min={0} max={168} defaultValue={rules.matchCutoffMinutes / 60} />
        </div>
      </div>
    </>
  );
}
