import { MapPin } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { WEEKDAYS } from "@/lib/opening-hours";
import type { Section } from "@/lib/sections/sections";
import { clockLabel } from "@/lib/site/hours";
import { mapsLink } from "@/lib/site/paths";
import { m } from "@/messages";
import { sectionStyle } from "../section-style";

/** The week's hours for every section side by side (today marked), and where to find the place (when the brand has an address). */
export function HoursAndLocation({ sections, address, today }: { sections: Section[]; address: string; today: number }) {
  return (
    <section id="visit" className="grid scroll-mt-20 gap-10 md:grid-cols-[3fr_2fr] md:gap-12">
      <div className="flex flex-col gap-6">
        <h2 className="font-display text-4xl uppercase tracking-wide">{address ? m.site.landing.hoursTitle : m.site.landing.hoursOnlyTitle}</h2>
        <table className="w-full table-fixed border-collapse text-left text-xs sm:text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-12 pb-2 font-normal text-muted-foreground sm:w-28">
                <span className="sr-only">{m.site.landing.day}</span>
              </th>
              {sections.map((s) => (
                <th key={s.id} scope="col" style={sectionStyle(s.accent)} className="pb-2 pr-2 font-display text-sm uppercase leading-tight tracking-wide text-section sm:text-base">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((d) => {
              const isToday = Number(d) === today;
              return (
                <tr key={d} aria-current={isToday ? "date" : undefined} className={cn("border-t border-border", isToday && "bg-raised font-semibold")}>
                  <th scope="row" className="py-2 pl-2 font-semibold">
                    <span className="sm:hidden">{m.weekdays[Number(d)]!.slice(0, 3)}</span>
                    <span className="hidden sm:inline">{m.weekdays[Number(d)]}</span>
                  </th>
                  {sections.map((s) => {
                    const hours = s.openingHours[d];
                    return (
                      <td key={s.id} className={cn("py-2 pr-2", !isToday && "text-muted-foreground")}>
                        {hours ? `${clockLabel(hours[0])} – ${clockLabel(hours[1])}` : m.manage.closed}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {address && (
        <div className="flex flex-col items-start gap-4 md:pt-16">
          <p className="flex gap-3 text-lg">
            <MapPin aria-hidden className="mt-1 size-5 shrink-0" />
            {address}
          </p>
          <a href={mapsLink(address)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "press h-10 px-4")}>
            {m.site.landing.maps}
          </a>
        </div>
      )}
    </section>
  );
}
