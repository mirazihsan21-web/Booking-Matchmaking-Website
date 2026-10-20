import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { m } from "@/messages";

async function VenueList() {
  const user = await requireUser("/manage");
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_members")
    .select("role, organizations(slug, name, status)")
    .eq("user_id", user.id);
  const venues = (data ?? []).flatMap((row) => {
    const org = row.organizations as unknown as { slug: string; name: string; status: string } | null;
    return org ? [{ ...org, role: row.role as string }] : [];
  });

  if (venues.length === 0) return <p className="text-foreground/70">{m.manage.noVenues}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {venues.map((v) => (
        <li key={v.slug}>
          <Link href={`/manage/${v.slug}`} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted">
            <span className="font-medium">{v.name}</span>
            <span className="flex gap-2">
              <Badge variant="outline">{m.manage.roles[v.role]}</Badge>
              <Badge variant={v.status === "live" ? "default" : "secondary"}>{m.status[v.status]}</Badge>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ManageHome() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.manage.myVenues}</h1>
        <Link href="/onboarding" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {m.manage.createVenue}
        </Link>
      </div>
      <Suspense fallback={null}>
        <VenueList />
      </Suspense>
    </main>
  );
}
