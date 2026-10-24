import { Suspense } from "react";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { SectionFields } from "@/components/manage/section-fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadSections } from "@/lib/sections/sections";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { addSectionAction, deleteSectionAction, saveSectionAction } from "../actions";

const kindOptions = Object.entries(m.manage.sectionKinds).map(([value, label]) => ({ value, label }));

async function Sections({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "owner");
  const sections = await loadSections(await createClient(), org.id);

  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: s.accent }} />
              {s.name}
              <Badge variant="outline">{m.manage.sectionKinds[s.kind]}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ActionForm action={saveSectionAction.bind(null, org.slug, s.id)} submitLabel={m.manage.save}>
              <SectionFields section={s} />
            </ActionForm>
            <ActionButton action={deleteSectionAction.bind(null, org.slug, s.id)} label={m.manage.delete} variant="destructive" />
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>{m.manage.addSection}</CardTitle>
          <CardDescription>{m.manage.addSectionIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={addSectionAction.bind(null, org.slug)} submitLabel={m.manage.add} resetOnSuccess>
            <SelectField name="kind" label={m.manage.sectionKind} options={kindOptions} />
            <Field name="name" label={m.manage.name} required />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SectionsPage({ params }: PageProps<"/manage/[slug]/sections">) {
  return (
    <Suspense fallback={null}>
      <Sections params={params} />
    </Suspense>
  );
}
