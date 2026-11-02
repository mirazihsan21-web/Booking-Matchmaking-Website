import { sectionStyle } from "@/components/site/section-style";
import type { Section } from "@/lib/sections/sections";

/** Section chips in their colours (Staff page, My account). */
export function SectionChips({ sections }: { sections: Pick<Section, "id" | "name" | "accent">[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {sections.map((s) => (
        <span key={s.id} style={sectionStyle(s.accent)} className="rounded-full border border-section px-2 py-0.5 text-xs font-semibold text-section">
          {s.name}
        </span>
      ))}
    </span>
  );
}
