import type { Metadata } from "next";
import { Anton, Inter } from "next/font/google";
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

export const metadata: Metadata = {
  title: m.platform.name,
  description: m.platform.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
