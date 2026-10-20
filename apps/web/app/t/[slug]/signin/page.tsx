import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNext } from "@/lib/auth/redirect";
import { getLiveOrganization } from "@/lib/tenancy/org";
import { m } from "@/messages";

async function Form({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const [{ slug }, { next, error }] = await Promise.all([params, searchParams]);
  const org = await getLiveOrganization(slug);
  return (
    <>
      <h1 className="text-3xl font-semibold text-primary">{m.auth.tenantTitle(org?.name ?? "")}</h1>
      {error && <p className="text-sm text-destructive">{m.auth.linkFailed}</p>}
      <SignInForm next={safeNext(next ?? "/me")} />
    </>
  );
}

export default function TenantSignInPage({ params, searchParams }: PageProps<"/t/[slug]/signin">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <Suspense fallback={null}>
        <Form params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
