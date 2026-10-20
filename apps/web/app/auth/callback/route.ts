import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/lib/auth/complete-sign-in";
import { requestOrigin, safeNext } from "@/lib/auth/redirect";
import { acceptPendingInvites } from "@/lib/orgs/invites";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { resolveHost } from "@/lib/tenancy/host";

const ROOT = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

/**
 * Where email links and Google sign-in land (on whichever host started the sign-in).
 * Accepts a PKCE `code` or, for staff invite emails, a one-time `token_hash`; on the root site it also
 * turns pending staff invites into memberships.
 */
export async function GET(request: NextRequest) {
  const host = request.headers.get("host");
  const origin = requestOrigin(host, request.url, ROOT());
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));

  const supabase = await createClient();
  if (await completeSignIn(supabase, url.searchParams)) {
    if (resolveHost(host, ROOT()).kind === "root") {
      const { data } = await supabase.auth.getClaims();
      const claims = data?.claims;
      if (claims?.sub && typeof claims.email === "string") {
        await acceptPendingInvites(createServiceClient(), claims.sub, claims.email);
      }
    }
    return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/signin?error=link", origin));
}
