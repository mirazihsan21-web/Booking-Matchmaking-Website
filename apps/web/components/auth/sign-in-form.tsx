"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { m } from "@/messages";

type State = "idle" | "sending" | "sent" | "error";

/** Email magic link (always) and Google (when enabled). Both come back through /auth/callback on this host. */
export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    setState(error ? "error" : "sent");
  }

  async function continueWithGoogle() {
    await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  }

  if (state === "sent") {
    return <p className="rounded-lg bg-accent/20 p-4 text-sm">{m.auth.checkEmail}</p>;
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {googleEnabled && (
        <>
          <Button type="button" variant="outline" onClick={continueWithGoogle}>
            {m.auth.google}
          </Button>
          <p className="text-center text-xs text-foreground/50">{m.auth.or}</p>
        </>
      )}
      <form onSubmit={sendLink} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          {m.auth.emailLabel}
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={state === "sending"}>
          {state === "sending" ? m.auth.sending : m.auth.sendLink}
        </Button>
        {state === "error" && <p className="text-sm text-destructive">{m.auth.error}</p>}
      </form>
    </div>
  );
}
