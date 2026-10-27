import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/service-client";
import { oldBookSection } from "@/lib/site/home";
import { movedBookPath, movedTo } from "@/lib/site/route";
import { getBrand } from "@/lib/tenancy/brand";

/**
 * Old venue links (`<slug>.<root>/…`) land here from the proxy: the same page on the one site. The old
 * booking page (`/book?section=…&resource=…`) is no page now, so it goes to its section's booking page.
 */
export async function GET(request: NextRequest) {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  let path = request.headers.get("x-moved-to");
  const old = path ? URL.parse(path, "http://moved.invalid") : null;
  if (old?.pathname === "/book") {
    const brand = await getBrand();
    const slug = brand ? await oldBookSection(createServiceClient(), brand.id, old.searchParams) : null;
    path = movedBookPath(old.search, slug);
  }
  return NextResponse.redirect(movedTo(path, root), 308);
}
