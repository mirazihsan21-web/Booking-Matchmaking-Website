import { Suspense } from "react";
import { ActionButton, ActionForm, Field, FieldError, SelectField } from "@/components/forms/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMembers } from "@/lib/orgs/members";
import { loadSections } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { cancelInviteAction, changeRoleAction, inviteStaffAction, removeMemberAction } from "../actions";

const roleOptions = [
  { value: "staff", label: m.manage.roles.staff! },
  { value: "owner", label: m.manage.roles.owner! },
];

async function Staff({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, user } = await requireOrgRole(slug, "owner");
  // Member emails come from the Auth admin API, so this read uses the service client (owner checked above).
  const members = await listMembers(createServiceClient(), org.id);
  const supabase = await createClient();
  const [{ data: invites }, sections, { data: assigned }] = await Promise.all([
    supabase
      .from("organization_invites")
      .select("id, email, role")
      .eq("organization_id", org.id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()),
    loadSections(supabase, org.id),
    supabase.from("section_staff").select("user_id, section_id").eq("organization_id", org.id),
  ]);
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const sectionsOf = (userId: string) =>
    sections.filter((s) => (assigned ?? []).some((a) => a.user_id === userId && a.section_id === s.id)).map((s) => sectionName.get(s.id)).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{m.manage.staff}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {members.map((member) => (
            <div key={member.userId} className="flex flex-wrap items-end gap-3 border-b border-border pb-3 last:border-0">
              <span className="min-w-56 text-sm">
                {member.email} {member.userId === user.id && <span className="text-foreground/50">{m.manage.you}</span>}
                <span className="block text-xs text-foreground/60">{member.role === "owner" ? m.manage.allSections : sectionsOf(member.userId) || "—"}</span>
              </span>
              <ActionForm action={changeRoleAction.bind(null, org.slug, member.userId)} submitLabel={m.manage.changeRole} variant="outline" className="flex-row items-end">
                <SelectField name="role" label={m.manage.role} options={roleOptions} defaultValue={member.role} />
              </ActionForm>
              <ActionButton action={removeMemberAction.bind(null, org.slug, member.userId)} label={m.manage.remove} variant="destructive" />
            </div>
          ))}
        </CardContent>
      </Card>
      {(invites ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{m.manage.pendingInvites}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {invites!.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3">
                  <span className="min-w-56">
                    {i.email} — {m.manage.roles[i.role]}
                  </span>
                  <ActionButton action={cancelInviteAction.bind(null, org.slug, i.id)} label={m.manage.cancelInvite} variant="outline" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{m.manage.invite}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={inviteStaffAction.bind(null, org.slug)} submitLabel={m.manage.invite} resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <Field name="email" label={m.manage.email} type="email" required />
              <SelectField name="role" label={m.manage.role} options={roleOptions} defaultValue="staff" />
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">{m.manage.staffSections}</legend>
              <p className="text-xs text-foreground/60">{m.manage.staffSectionsHint}</p>
              <div className="flex flex-wrap gap-4 text-sm">
                {sections.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="sectionIds" value={s.id} defaultChecked />
                    {s.name}
                  </label>
                ))}
              </div>
              <FieldError name="sectionIds" />
            </fieldset>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StaffPage({ params }: PageProps<"/manage/[slug]/staff">) {
  return (
    <Suspense fallback={null}>
      <Staff params={params} />
    </Suspense>
  );
}
