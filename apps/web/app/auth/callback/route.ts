import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin, safeNext } from "@/lib/auth/redirect";
import { acceptPendingInvites } from "@/lib/orgs/invites";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { resolveHost } from "@/lib/tenancy/host";

const ROOT = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

/**
 * Where email links and Google sign-in land (on whichever host started the sign-in).
 * Exchanges the PKCE code for a session; on the root site also turns pending staff invites into memberships.
 */
export async function GET(request: NextRequest) {
  const host = request.headers.get("host");
  const origin = requestOrigin(host, request.url, ROOT());
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (resolveHost(host, ROOT()).kind === "root") {
        const { data } = await supabase.auth.getClaims();
        const claims = data?.claims;
        if (claims?.sub && typeof claims.email === "string") {
          await acceptPendingInvites(createServiceClient(), claims.sub, claims.email);
        }
      }
      return NextResponse.redirect(new URL(next, origin));
    }
  }
  return NextResponse.redirect(new URL("/signin?error=link", origin));
}
