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
  // The boot script rewrites this to the light ground when the light theme is
  // stored, so the phone's status bar and the installed app's chrome follow the
  // theme rather than always wearing the dark one.
  themeColor: "#0e0e0e",
};

/**
 * Stamp the stored theme onto <html> BEFORE first paint.
 *
 * The theme used to be applied in an effect inside AppShell, which runs after
 * hydration — so anyone on the light theme loaded the app dark and watched it turn
 * over, every visit. A blocking inline script is the one correct place for this:
 * there is no earlier hook, and it is three lines that cannot fail into a broken
 * page (a throw leaves the default dark, which is what the CSS already says).
 *
 * It also moves the <meta name="theme-color">, so the phone's own status bar and
 * the PWA's chrome match the app instead of always wearing the dark ground.
 */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark')t='dark';document.documentElement.setAttribute('data-theme',t);var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',t==='light'?'#efe8da':'#0e0e0e');}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${GeistSans.variable} ${GeistMono.variable}`} data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="h-full">
        <Pwa />
        {children}
      </body>
    </html>
  );
}
