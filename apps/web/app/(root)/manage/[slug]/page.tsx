import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { publishAction } from "./actions";

async function Overview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, role } = await requireOrgRole(slug, "staff");
  const supabase = await createClient();
  const count = async (table: string, filter: { active?: boolean; upcoming?: boolean } = {}) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org.id);
    if (filter.active) q = q.eq("active", true);
    if (filter.upcoming) q = q.eq("status", "open").gte("starts_at", new Date().toISOString());
    return (await q).count ?? 0;
  };
  const stats = [
    { label: m.manage.counts.sections, value: await count("sections") },
    { label: m.manage.counts.resources, value: await count("resources", { active: true }) },
    { label: m.manage.counts.activities, value: await count("activities", { active: true }) },
    { label: m.manage.counts.sessions, value: await count("open_play_sessions", { upcoming: true }) },
  ];

  return (
    <div className="flex flex-col gap-6">
      {org.status === "suspended" && <p className="text-destructive">{m.manage.suspendedNotice}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-foreground/70">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{s.value}</CardContent>
          </Card>
        ))}
      </div>
      {org.status === "onboarding" && role === "owner" && (
        <ActionButton action={publishAction.bind(null, org.slug)} label={m.manage.publish} variant="default" />
      )}
    </div>
  );
}

export default function ManageOverviewPage({ params }: PageProps<"/manage/[slug]">) {
  return (
    <Suspense fallback={null}>
      <Overview params={params} />
    </Suspense>
  );
}
