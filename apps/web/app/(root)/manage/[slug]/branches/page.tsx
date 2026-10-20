import { Suspense } from "react";
import { ActionButton, ActionForm, Field } from "@/components/forms/action-form";
import { OpeningHoursEditor } from "@/components/manage/opening-hours-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/lib/opening-hours";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { deleteBranchAction, saveBranchAction } from "../actions";

async function Branches({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await requireOrgRole(slug, "owner");
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, address, opening_hours")
    .eq("organization_id", org.id)
    .order("created_at");

  return (
    <div className="flex flex-col gap-6">
      {(branches ?? []).map((b) => (
        <Card key={b.id}>
          <CardHeader>
            <CardTitle>{b.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ActionForm action={saveBranchAction.bind(null, org.slug, b.id)} submitLabel={m.manage.save}>
              <Field name="name" label={m.manage.name} defaultValue={b.name} required />
              <Field name="address" label={m.manage.address} defaultValue={b.address} />
              <OpeningHoursEditor value={b.opening_hours as OpeningHours} />
            </ActionForm>
            <ActionButton action={deleteBranchAction.bind(null, org.slug, b.id)} label={m.manage.delete} variant="destructive" />
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>{m.manage.addBranch}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveBranchAction.bind(null, org.slug, null)} submitLabel={m.manage.add}>
            <Field name="name" label={m.manage.name} required />
            <Field name="address" label={m.manage.address} />
            <OpeningHoursEditor value={DEFAULT_OPENING_HOURS} />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BranchesPage({ params }: PageProps<"/manage/[slug]/branches">) {
  return (
    <Suspense fallback={null}>
      <Branches params={params} />
    </Suspense>
  );
}
