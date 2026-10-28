import { Suspense } from "react";
import { ActionButton, ActionForm, Field, FieldError, SelectField } from "@/components/forms/action-form";
import { ConfirmAction } from "@/components/manage/confirm-action";
import { sectionStyle } from "@/components/site/section-style";
import { listMembers } from "@/lib/orgs/members";
import { loadSections, type Section } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { cancelInviteAction, inviteStaffAction, makeOwnerAction, makeStaffAction, removeMemberAction, setSectionsAction } from "./actions";

const roleOptions = [
  { value: "staff", label: m.manage.roles.staff! },
  { value: "owner", label: m.manage.roles.owner! },
];

/** Section chips in their colours. */
function Chips({ sections }: { sections: Section[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {sections.map((s) => (
        <span key={s.id} style={sectionStyle(s.accent)} className="rounded-full border border-section px-2 py-0.5 text-xs font-semibold text-section">
          {s.name}
        </span>
      ))}
    </span>
  );
}

/** Tick boxes for the brand's sections (`sectionIds`), with the ticked ones given. */
function SectionBoxes({ sections, checked }: { sections: Section[]; checked: (id: string) => boolean }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{m.manage.staffSections}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {sections.map((s) => (
          <label key={s.id} className="flex items-center gap-1.5">
            <input type="checkbox" name="sectionIds" value={s.id} defaultChecked={checked(s.id)} className="size-4 accent-foreground" />
            {s.name}
          </label>
        ))}
      </div>
      <FieldError name="sectionIds" />
    </fieldset>
  );
}

/** A panel that opens in place (works before the page's scripts load). */
function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group w-full">
      <summary className="inline-flex cursor-pointer list-none items-center rounded-lg border border-border px-2.5 py-1 text-sm font-medium hover:border-foreground/40 group-open:border-foreground/40">
        {label}
      </summary>
      <div className="mt-3 rounded-lg bg-raised p-3">{children}</div>
    </details>
  );
}

/** The team (owner only): who runs which sections, their role, invites. */
async function Staff() {
  const { org, user } = await requireManager("owner");
  const db = createServiceClient();
  const [members, sections, { data: assigned }, { data: invites }] = await Promise.all([
    listMembers(db, org.id),
    loadSections(db, org.id),
    db.from("section_staff").select("user_id, section_id").eq("organization_id", org.id),
    db
      .from("organization_invites")
      .select("id, email, role, section_ids")
      .eq("organization_id", org.id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at"),
  ]);
  const runs = (userId: string) => new Set((assigned ?? []).filter((a) => a.user_id === userId).map((a) => a.section_id as string));
  const p = m.manage.staffPage;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-4xl uppercase tracking-wide">{p.title}</h1>

      <ul className="flex flex-col gap-3">
        {members.map((member) => {
          const mine = runs(member.userId);
          const isOwner = member.role === "owner";
          const email = member.email ?? "—";
          return (
            <li key={member.userId} className="flex flex-col gap-3 rounded-xl bg-card p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-semibold">{email}</span>
                {member.userId === user.id && <span className="text-sm text-muted-foreground">{m.manage.you}</span>}
                <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold">{m.manage.roles[member.role]}</span>
                {isOwner ? (
                  <span className="text-sm text-muted-foreground">{m.manage.allSections}</span>
                ) : (
                  <Chips sections={sections.filter((s) => mine.has(s.id))} />
                )}
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {isOwner ? (
                  <Disclosure label={p.makeStaff}>
                    <ActionForm action={makeStaffAction.bind(null, member.userId)} submitLabel={p.makeStaff} variant="outline">
                      <SectionBoxes sections={sections} checked={() => true} />
                    </ActionForm>
                  </Disclosure>
                ) : (
                  <>
                    <Disclosure label={p.editSections}>
                      <ActionForm action={setSectionsAction.bind(null, member.userId)} submitLabel={m.manage.save} variant="default">
                        <SectionBoxes sections={sections} checked={(id) => mine.has(id)} />
                      </ActionForm>
                    </Disclosure>
                    <ActionButton action={makeOwnerAction.bind(null, member.userId)} label={p.makeOwner} />
                  </>
                )}
                <ConfirmAction
                  action={removeMemberAction.bind(null, member.userId)}
                  label={m.manage.remove}
                  question={p.removeQuestion(email)}
                  confirmLabel={m.manage.remove}
                  cancelLabel={p.keep}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {(invites ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl uppercase tracking-wide">{m.manage.pendingInvites}</h2>
          <ul className="flex flex-col gap-2">
            {invites!.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-card px-4 py-3 text-sm">
                <span className="font-semibold">{i.email}</span>
                <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold">{m.manage.roles[i.role]}</span>
                {i.role === "owner" ? (
                  <span className="text-muted-foreground">{m.manage.allSections}</span>
                ) : (
                  <Chips sections={sections.filter((s) => (i.section_ids as string[]).includes(s.id))} />
                )}
                <span className="ml-auto">
                  <ActionButton action={cancelInviteAction.bind(null, i.id)} label={m.manage.cancelInvite} variant="ghost" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex max-w-2xl flex-col gap-3 rounded-xl bg-card p-5">
        <h2 className="font-display text-2xl uppercase tracking-wide">{p.inviteTitle}</h2>
        <p className="text-sm text-muted-foreground">{m.manage.staffSectionsHint}</p>
        <ActionForm action={inviteStaffAction} submitLabel={m.manage.invite} variant="default" resetOnSuccess className="gap-4">
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
            <Field name="email" label={m.manage.email} type="email" required />
            <SelectField name="role" label={m.manage.role} options={roleOptions} defaultValue="staff" />
          </div>
          <SectionBoxes sections={sections} checked={() => true} />
        </ActionForm>
      </section>
    </div>
  );
}

export default function StaffPage() {
  return (
    <Suspense fallback={null}>
      <Staff />
    </Suspense>
  );
}
