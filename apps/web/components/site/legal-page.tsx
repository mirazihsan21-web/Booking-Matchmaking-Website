import { m } from "@/messages";

export interface LegalSection {
  heading: string;
  paragraphs: readonly string[];
}

/**
 * A plain page of policy text (privacy, terms): title, date, intro, sections, and how to reach the venue,
 * by email when the site has an address to send from, else at the venue.
 */
export function LegalPage({
  title,
  intro,
  sections,
  contact,
}: {
  title: string;
  intro: string;
  sections: readonly LegalSection[];
  contact: { email: string | null; address: string };
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6">
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{m.legal.updated}</p>
          <p className="text-lg">{intro}</p>
        </header>
        {sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">{section.heading}</h2>
            {section.paragraphs.map((text) => (
              <p key={text} className="leading-relaxed text-muted-foreground">
                {text}
              </p>
            ))}
          </section>
        ))}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{m.legal.contactHeading}</h2>
          <p className="leading-relaxed text-muted-foreground">
            {contact.email ? (
              <>
                {m.legal.contactEmail}{" "}
                <a href={`mailto:${contact.email}`} className="font-semibold text-foreground underline underline-offset-4">
                  {contact.email}
                </a>
                .
              </>
            ) : (
              m.legal.contactVenue(contact.address)
            )}
          </p>
        </section>
      </article>
    </main>
  );
}
