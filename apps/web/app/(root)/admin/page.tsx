import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { isPlatformAdmin, listOrganizations } from "@/lib/admin/platform";
import { requireUser } from "@/lib/auth/dal";
import { createServiceClient } from "@/lib/service-client";
import { tenantUrl } from "@/lib/tenancy/urls";
import { m } from "@/messages";
import { setStatusAction } from "./actions";

async function Organizations() {
  const user = await requireUser("/admin");
  const db = createServiceClient();
  if (!(await isPlatformAdmin(db, user.id))) notFound();
  const orgs = await listOrganizations(db);

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-foreground/60">
        <tr>
          <th className="py-2">{m.admin.venue}</th>
          <th>{m.admin.type}</th>
          <th>{m.admin.owner}</th>
          <th>{m.admin.created}</th>
          <th>{m.admin.status}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {orgs.map((o) => (
          <tr key={o.id} className="border-t border-border">
            <td className="py-2">
              <a href={tenantUrl(o.slug)} className="font-medium hover:underline">
                {o.name}
              </a>
              <div className="text-xs text-foreground/50">{o.slug}</div>
            </td>
            <td>{m.onboarding.types[o.businessType]}</td>
            <td>{o.ownerEmail ?? "—"}</td>
            <td>{o.createdAt.slice(0, 10)}</td>
            <td>
              <Badge variant={o.status === "live" ? "default" : "secondary"}>{m.status[o.status]}</Badge>
            </td>
            <td className="text-right">
              {o.status === "suspended" ? (
                <ActionButton action={setStatusAction.bind(null, o.id, "live")} label={m.admin.restore} />
              ) : (
                <ActionButton action={setStatusAction.bind(null, o.id, "suspended")} label={m.admin.suspend} variant="destructive" />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">{m.admin.title}</h1>
      <Suspense fallback={null}>
        <Organizations />
      </Suspense>
    </main>
  );
}
