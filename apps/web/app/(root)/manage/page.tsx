import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { m } from "@/messages";

/**
 * There is one brand (BRAND_SLUG): its staff go straight to its manage pages. It goes by the slug, not
 * getBrand(), so an owner can still reach a brand that isn't live yet to publish it.
 */
async function ToBrand() {
  const user = await requireUser("/manage");
  const slug = process.env.BRAND_SLUG ?? "";
  const supabase = await createClient();
  const { data } = slug
    ? await supabase.from("organization_members").select("organizations!inner(slug)").eq("user_id", user.id).eq("organizations.slug", slug).maybeSingle()
    : { data: null };
  if (data) redirect(`/manage/${slug}`);
  return <p className="text-muted-foreground">{m.manage.noVenues}</p>;
}

export default function ManageHome() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <h1 className="font-display text-4xl uppercase tracking-wide">{m.manage.myVenues}</h1>
      <Suspense fallback={null}>
        <ToBrand />
      </Suspense>
    </main>
  );
}
