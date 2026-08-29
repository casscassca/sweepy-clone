import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sweepy",
    short_name: "Sweepy",
    description: "Home cleaning task manager",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1c2830",
    theme_color: "#7c3aed",
    icons: [
      { src: "/icon-cluster-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-cluster-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-monochrome.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
  };
}
