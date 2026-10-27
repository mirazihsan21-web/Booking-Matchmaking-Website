import { NextResponse, type NextRequest } from "next/server";
import { movedTo } from "@/lib/site/route";

/** Old venue links (`<slug>.<root>/…`) land here from the proxy: the same page on the one site. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(movedTo(request.headers.get("x-moved-to"), process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"), 308);
}
