import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Manrope, Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import ClientShell from "@/src/components/ClientShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EchoMind — Second Brain",
  description: "Your AI-powered second brain. Capture, recall, and analyze your thoughts.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`
          ${geistSans.variable} 
          ${geistMono.variable} 
          ${manrope.variable} 
          ${inter.variable} 
          ${plusJakarta.variable} 
          antialiased
          no-select
          no-tap-highlight
        `}
        suppressHydrationWarning
      >
        {/* Liquid Mesh Background */}
        <div className="liquid-mesh" />

        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
