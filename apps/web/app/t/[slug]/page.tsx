import { Suspense } from "react";
import { getLiveOrganization } from "@/lib/tenancy/org";

// Placeholder venue home; Task 13 builds the full public page.
async function VenueHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getLiveOrganization(slug);
  return <h1 className="text-4xl font-semibold text-primary">{org?.name}</h1>;
}

export default function TenantHome({ params }: PageProps<"/t/[slug]">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <Suspense fallback={null}>
        <VenueHome params={params} />
      </Suspense>
    </main>
  );
}
