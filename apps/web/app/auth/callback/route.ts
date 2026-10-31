import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/lib/auth/complete-sign-in";
import { landingAfterSignIn, requestOrigin, safeNext } from "@/lib/auth/redirect";
import { acceptPendingInvites } from "@/lib/orgs/invites";
import { createServiceClient } from "@/lib/service-client";
import { createClient } from "@/lib/supabase/server";
import { isBrandTeamMember } from "@/lib/tenancy/team";

const ROOT = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

/**
 * Where email links and Google sign-in land. Accepts a PKCE `code` or, for staff invite emails, a
 * one-time `token_hash`, then turns the person's pending staff invites into memberships. The brand's
 * owners and staff who had no page in mind land in the manage area.
 */
export async function GET(request: NextRequest) {
  const host = request.headers.get("host");
  const origin = requestOrigin(host, request.url, ROOT());
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));

  const supabase = await createClient();
  if (await completeSignIn(supabase, url.searchParams)) {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (claims?.sub && typeof claims.email === "string") {
      await acceptPendingInvites(createServiceClient(), claims.sub, claims.email);
    }
    const isTeam = typeof claims?.sub === "string" && (await isBrandTeamMember(createServiceClient(), claims.sub));
    return NextResponse.redirect(new URL(landingAfterSignIn(next, isTeam), origin));
  }
  return NextResponse.redirect(new URL("/signin?error=link", origin));
}
