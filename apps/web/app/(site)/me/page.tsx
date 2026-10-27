import { Suspense } from "react";
import { ActionForm, Field, FieldError } from "@/components/forms/action-form";
import { AvailabilityEditor, type AvailabilityValue } from "@/components/profile/availability-editor";
import { RatingPicker } from "@/components/profile/rating-picker";
import { MeTabs } from "@/components/site/me-tabs";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";
import { saveProfileAction } from "./actions";

const hhmm = (t: string) => t.slice(0, 5);

async function Profile() {
  const user = await requireUser("/me");
  const brand = await getBrand();
  if (!brand) return null; // the layout shows "Not open yet"
  const supabase = await createClient();
  const [{ data: profile }, { data: activities }] = await Promise.all([
    supabase
      .from("player_profiles")
      .select(
        "id, display_name, phone, email_opt_in, profile_activities(activity_id, rank), availability(weekday, start_time, end_time), profile_section_skills(section_id, skill)",
      )
      .eq("organization_id", brand.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("activities").select("id, name").eq("organization_id", brand.id).eq("active", true).order("name"),
  ]);
  const ratings = new Map(((profile?.profile_section_skills as Array<{ section_id: string; skill: number }> | undefined) ?? []).map((r) => [r.section_id, r.skill]));
  const ranked = [...((profile?.profile_activities as Array<{ activity_id: string; rank: number }> | undefined) ?? [])].sort((a, b) => a.rank - b.rank);
  const availability: AvailabilityValue = Object.fromEntries(
    ((profile?.availability as Array<{ weekday: number; start_time: string; end_time: string }> | undefined) ?? []).map((a) => [
      String(a.weekday),
      { start: hhmm(a.start_time), end: hhmm(a.end_time) },
    ]),
  );
  const activityOptions = [{ value: "", label: m.profile.none }, ...(activities ?? []).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <div className="flex flex-col gap-6">
      <MeTabs active="profile" />
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl uppercase tracking-wide sm:text-5xl">{m.profile.title(brand.name)}</h1>
        <p className="text-muted-foreground">{m.profile.intro}</p>
      </div>
      <section className="rise rounded-xl bg-card p-5 sm:p-6">
        <ActionForm action={saveProfileAction} submitLabel={m.profile.save} className="gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="displayName" label={m.profile.displayName} defaultValue={profile?.display_name ?? ""} required />
            <Field name="phone" label={m.profile.phone} type="tel" defaultValue={profile?.phone ?? ""} placeholder="01712345678" />
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{m.profile.skillHint}</p>
            {brand.sections.map((s) => (
              <RatingPicker key={s.id} section={s} value={ratings.get(s.id) ?? null} />
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{m.profile.favourites}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <select
                  key={i}
                  name="favourites"
                  aria-label={`${m.profile.favourites} ${i + 1}`}
                  defaultValue={ranked[i]?.activity_id ?? ""}
                  className="h-9 rounded-lg border border-input bg-raised px-2 text-sm"
                >
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
            <input type="checkbox" name="emailOptIn" defaultChecked={profile?.email_opt_in ?? true} className="size-4 accent-foreground" />
            {m.profile.emailOptIn}
          </label>
        </ActionForm>
      </section>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Profile />
      </Suspense>
    </main>
  );
}
