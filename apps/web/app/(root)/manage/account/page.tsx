import { Suspense, type ReactNode } from "react";
import { Avatar } from "@/components/account/avatar";
import { ActionForm, Field } from "@/components/forms/action-form";
import { SectionChips } from "@/components/manage/section-chips";
import { signInMethods } from "@/lib/account/identity";
import { displayPhone } from "@/lib/forms/profile";
import { loadSections } from "@/lib/sections/sections";
import { createServiceClient } from "@/lib/service-client";
import { requireManager } from "@/lib/tenancy/manager";
import { m } from "@/messages";
import { saveMyDetailsAction } from "./actions";

/** One read-only line: a label above its value. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}

/** The signed-in owner's or staff member's own account: who they are here, their name and mobile, Sign out. */
async function Account() {
  const manager = await requireManager("staff");
  const a = m.manage.account;
  const isOwner = manager.role === "owner";
  const sections = isOwner ? [] : (await loadSections(createServiceClient(), manager.org.id)).filter((s) => manager.sectionIds.includes(s.id));
  const since = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: manager.org.timezone }).format(new Date(manager.memberSince));

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex items-center gap-4">
        <Avatar name={manager.displayName} src={manager.user.avatarUrl} size="lg" />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-4xl uppercase tracking-wide">{a.title}</h1>
          <p className="text-sm text-muted-foreground">
            {manager.displayName} · {m.manage.roles[manager.role]}
          </p>
        </div>
      </div>

      <section className="rounded-xl bg-card p-5">
        <ActionForm action={saveMyDetailsAction} submitLabel={m.manage.save} className="gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="displayName" label={a.name} defaultValue={manager.displayName} required maxLength={60} />
            <Field name="phone" label={a.phone} type="tel" defaultValue={manager.phone ? displayPhone(manager.phone) : ""} placeholder="01712345678" />
          </div>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-5 rounded-xl bg-card p-5">
        <Row label={a.email}>
          <p className="font-semibold">{manager.user.email ?? "—"}</p>
          <p className="text-sm text-muted-foreground">{a.emailHint}</p>
        </Row>
        <Row label={a.signIn}>{signInMethods(manager.user.providers)}</Row>
        <Row label={a.role}>{m.manage.roles[manager.role]}</Row>
        <Row label={a.sections}>
          {isOwner ? (
            m.manage.allSections
          ) : (
            <div className="flex flex-col gap-2">
              {sections.length > 0 ? <SectionChips sections={sections} /> : <p>{a.noSections}</p>}
              <p className="text-sm text-muted-foreground">{a.sectionsHint}</p>
            </div>
          )}
        </Row>
        <p className="text-sm text-muted-foreground">{a.since(since)}</p>
      </section>

      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-raised">
          {m.manage.nav.signOut}
        </button>
      </form>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <Account />
    </Suspense>
  );
}
