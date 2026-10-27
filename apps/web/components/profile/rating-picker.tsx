import { FieldError } from "@/components/forms/action-form";
import { sectionStyle } from "@/components/site/section-style";
import type { Section } from "@/lib/sections/sections";
import { m } from "@/messages";

/**
 * A player's level in one section: "Not rated" or 1–5, as tags. The radio group is named
 * `rating.<sectionId>` (what parseProfileForm reads; '' = not rated) and the picked tag fills in the
 * section's colour.
 */
export function RatingPicker({ section, value }: { section: Pick<Section, "id" | "name" | "accent">; value: number | null }) {
  const name = `rating.${section.id}`;
  const options = [{ value: "", label: m.profile.notRated }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${m.profile.skillLevels[n]}` }))];
  return (
    <fieldset style={sectionStyle(section.accent)} className="flex flex-col gap-2 rounded-xl border-l-[3px] border-section bg-raised p-4">
      <legend className="sr-only">{m.profile.skill(section.name)}</legend>
      <p aria-hidden className="text-sm font-semibold">
        <span className="font-display text-base uppercase tracking-wide text-section">{section.name}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value || "none"} className="relative">
            <input type="radio" name={name} value={o.value} defaultChecked={String(value ?? "") === o.value} className="peer sr-only" />
            <span className="press block cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:border-section peer-checked:border-section peer-checked:bg-section peer-checked:text-on-section peer-focus-visible:ring-2 peer-focus-visible:ring-section">
              {o.label}
            </span>
          </label>
        ))}
      </div>
      <FieldError name={name} />
    </fieldset>
  );
}
