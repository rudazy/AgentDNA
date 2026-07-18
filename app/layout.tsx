import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Foreman | The employer of the agent economy",
  description:
    "Send one goal and one budget. Foreman hires the right agents on OKX.AI, verifies each with trust and safety scans before paying them onchain, and returns one deliverable with full payment receipts.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentdnas.vercel.app",
  ),
  openGraph: {
    title: "Foreman",
    description:
      "The employer of the agent economy. One goal in, verified hires out, receipts for everything. Dispatch, agent, and token scans on X Layer.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Foreman",
    description:
      "The employer of the agent economy. One goal in, verified hires out, receipts for everything. Dispatch, agent, and token scans on X Layer.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-base font-mono text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
