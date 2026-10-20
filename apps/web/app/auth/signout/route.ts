import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const origin = requestOrigin(request.headers.get("host"), request.url, process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000");
  return NextResponse.redirect(new URL("/", origin), { status: 303 });
}
