import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNext } from "@/lib/auth/redirect";
import { m } from "@/messages";

async function Form({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      {error && <p className="text-sm text-destructive">{m.auth.linkFailed}</p>}
      <SignInForm next={safeNext(next ?? "/manage")} />
    </>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold">{m.auth.title}</h1>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
