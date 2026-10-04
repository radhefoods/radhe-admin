import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { themeScript } from "@/components/shell/theme";
import { instrumentSans, instrumentSerif } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Radhe Foods Admin", template: "%s · Radhe Foods Admin" },
  description: "The back office of Radhe Foods.",
  // A private tool: no search engine may list it.
  robots: { index: false, follow: false, nocache: true },
  referrer: "same-origin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#080c1d" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The nonce of this request (src/proxy.ts): the one inline script below
  // carries it, as do the scripts of Next.js.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${instrumentSerif.variable}`}
      // The theme script sets `data-theme` before React starts.
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
