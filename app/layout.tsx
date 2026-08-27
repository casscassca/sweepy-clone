import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import ThemeProvider from "@/components/ThemeProvider";
import BackupBanner from "@/components/BackupBanner";
import WarmCache from "@/components/WarmCache";

export const metadata: Metadata = {
  title: "Sweepy",
  description: "Home cleaning task manager",
  applicationName: "Sweepy",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Sweepy",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f9" },
    { media: "(prefers-color-scheme: dark)", color: "#08080f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col" style={{ background: "var(--bg)" }}>
        <ThemeProvider>
          <WarmCache />
          <Nav />
          {process.env.NODE_ENV === "production" && <BackupBanner />}
          <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 md:px-5 md:py-8 max-md:pb-24">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
