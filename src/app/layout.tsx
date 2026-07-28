import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_DESC =
  "Protecting Homes. Restoring Roofs. Powering Better Living. Anexa Homes delivers premium roofing, HVAC, water filtration, windows, gutters, and solar panel installation across North Texas.";

export const metadata: Metadata = {
  title: {
    default: "Anexa Homes — Roofing, Solar & Home Improvement",
    template: "%s | Anexa Homes",
  },
  description: SITE_DESC,
  metadataBase: new URL("https://anexahomes.com"),
  applicationName: "Anexa Homes",
  alternates: { canonical: "/" },
  keywords: [
    "roofing North Texas",
    "roof replacement Dallas",
    "storm damage roof repair",
    "insurance claim roofing",
    "solar panel installation",
    "HVAC",
    "water filtration",
  ],
  openGraph: {
    type: "website",
    siteName: "Anexa Homes",
    title: "Anexa Homes — Roofing, Solar & Home Improvement",
    description: SITE_DESC,
    url: "https://anexahomes.com",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Anexa Homes — Roofing & Home Improvement",
    description: SITE_DESC,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
