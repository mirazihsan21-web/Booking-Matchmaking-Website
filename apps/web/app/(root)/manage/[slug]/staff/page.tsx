import { Suspense } from "react";
import { ActionButton, ActionForm, Field, SelectField } from "@/components/forms/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMembers } from "@/lib/orgs/members";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { requireOrgRole } from "@/lib/tenancy/dal";
import { m } from "@/messages";
import { changeRoleAction, inviteStaffAction, removeMemberAction } from "../actions";

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
  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, email, role")
    .eq("organization_id", org.id)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString());

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
            <ul className="text-sm">
              {invites!.map((i) => (
                <li key={i.id}>
                  {i.email} — {m.manage.roles[i.role]}
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
          <ActionForm action={inviteStaffAction.bind(null, org.slug)} submitLabel={m.manage.invite} resetOnSuccess className="sm:grid sm:grid-cols-3 sm:items-end">
            <Field name="email" label={m.manage.email} type="email" required />
            <SelectField name="role" label={m.manage.role} options={roleOptions} defaultValue="staff" />
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
