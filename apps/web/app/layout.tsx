import type { Metadata } from "next";
import { Anton, Inter } from "next/font/google";
import { createServiceClient } from "@/lib/service-client";
import { loadBrand } from "@/lib/tenancy/brand";
import { m } from "@/messages";
import "./globals.css";

// Headlines: Anton (tall, uppercase). Everything else: Inter. Both are served with the site.
const display = Anton({
  weight: "400",
  variable: "--font-display",
  subsets: ["latin"],
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

/** The brand's name as the site title (cached: it's the brand's data, not the visitor's). */
export async function generateMetadata(): Promise<Metadata> {
  "use cache";
  const brand = await loadBrand(createServiceClient(), process.env.BRAND_SLUG ?? "");
  return brand
    ? { title: brand.name, description: brand.sections.map((s) => s.name).join(" · ") }
    : { title: m.platform.name, description: m.platform.tagline };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions (e.g. QuillBot) add attributes to <html> before React loads; this only silences that element.
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
