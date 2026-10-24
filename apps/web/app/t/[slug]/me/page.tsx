import { Suspense } from "react";
import { ActionForm, Field, FieldError, SelectField } from "@/components/forms/action-form";
import { AvailabilityEditor, type AvailabilityValue } from "@/components/profile/availability-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/auth/dal";
import { loadSections } from "@/lib/sections/sections";
import { createClient } from "@/lib/supabase/server";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { m } from "@/messages";
import { saveProfileAction } from "./actions";

const hhmm = (t: string) => t.slice(0, 5);

async function Profile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser("/me");
  const org = await getLiveOrganization(slug);
  if (!org) return null;
  const supabase = await createClient();
  const [{ data: profile }, { data: activities }, sections] = await Promise.all([
    supabase
      .from("player_profiles")
      .select(
        "id, display_name, phone, email_opt_in, profile_activities(activity_id, rank), availability(weekday, start_time, end_time), profile_section_skills(section_id, skill)",
      )
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("activities").select("id, name").eq("organization_id", org.id).eq("active", true).order("name"),
    loadSections(supabase, org.id),
  ]);
  const ratings = new Map(((profile?.profile_section_skills as Array<{ section_id: string; skill: number }> | undefined) ?? []).map((r) => [r.section_id, r.skill]));
  const levelOptions = [{ value: "", label: m.profile.notRated }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${m.profile.skillLevels[n]}` }))];

  const ranked = [...((profile?.profile_activities as Array<{ activity_id: string; rank: number }> | undefined) ?? [])].sort((a, b) => a.rank - b.rank);
  const availability: AvailabilityValue = Object.fromEntries(
    ((profile?.availability as Array<{ weekday: number; start_time: string; end_time: string }> | undefined) ?? []).map((a) => [
      String(a.weekday),
      { start: hhmm(a.start_time), end: hhmm(a.end_time) },
    ]),
  );
  const activityOptions = [{ value: "", label: m.profile.none }, ...(activities ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{m.profile.title(org.name)}</CardTitle>
        <CardDescription>{m.profile.intro}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={saveProfileAction.bind(null, org.slug)} submitLabel={m.profile.save}>
          <Field name="displayName" label={m.profile.displayName} defaultValue={profile?.display_name ?? ""} required />
          <Field name="phone" label={m.profile.phone} type="tel" defaultValue={profile?.phone ?? ""} placeholder="01712345678" />
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground/70">{m.profile.skillHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((s) => (
                <SelectField
                  key={s.id}
                  name={`rating.${s.id}`}
                  label={m.profile.skill(s.name)}
                  defaultValue={String(ratings.get(s.id) ?? "")}
                  options={levelOptions}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{m.profile.favourites}</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <select key={i} name="favourites" defaultValue={ranked[i]?.activity_id ?? ""} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
                  {activityOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ))}
            </div>
            <FieldError name="favourites" />
          </div>
          <AvailabilityEditor value={availability} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="emailOptIn" defaultChecked={profile?.email_opt_in ?? true} />
            {m.profile.emailOptIn}
          </label>
        </ActionForm>
      </CardContent>
    </Card>
  );
}

export default function ProfilePage({ params }: PageProps<"/t/[slug]/me">) {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-10">
      <Suspense fallback={null}>
        <Profile params={params} />
      </Suspense>
    </main>
  );
}
