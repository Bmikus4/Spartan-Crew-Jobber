import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Pwa from "./components/Pwa";

export const metadata: Metadata = {
  title: "Spartan Crew — Jobber",
  description: "Enquiry → booking automation for Spartan Crew.",
  applicationName: "Spartan Crew",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "Spartan Crew" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0e0e0e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="h-full">
        <Pwa />
        {children}
      </body>
    </html>
  );
}
