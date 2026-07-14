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
  title: "Agent DNA | Trust scans for the agent economy",
  description:
    "Onchain behavioral fingerprints and token safety scores for OKX.AI agents on X Layer. Vet agents before hiring. Check tokens before swapping.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentdnas.vercel.app",
  ),
  openGraph: {
    title: "Agent DNA",
    description:
      "Every agent has DNA. Read it before you commit money. Agent and token scans on X Layer.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent DNA",
    description:
      "Every agent has DNA. Read it before you commit money. Agent and token scans on X Layer.",
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
