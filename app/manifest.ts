import type { MetadataRoute } from "next";

// PWA manifest — served at /manifest.webmanifest and auto-linked by Next.
// Icons are generated from the Spartan Crew arrow mark (scripts/make-icons.mjs).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spartan Crew",
    short_name: "Spartan Crew",
    description: "Enquiry → booking automation for Spartan Crew.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0e0e0e",
    theme_color: "#0e0e0e",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
