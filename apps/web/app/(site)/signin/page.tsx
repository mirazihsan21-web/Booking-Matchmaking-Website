import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNext } from "@/lib/auth/redirect";
import { m } from "@/messages";

/** One sign-in for everyone: players come back to the page they were on (or home), staff to `next=/manage`. */
async function Form({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      {error && <p className="text-sm text-destructive">{m.auth.linkFailed}</p>}
      <SignInForm next={safeNext(next ?? "/")} />
    </>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-6">
      <h1 className="font-display text-5xl uppercase tracking-wide">{m.auth.title}</h1>
      <div className="rise rounded-xl bg-card p-5 sm:p-6">
        <Suspense fallback={null}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
