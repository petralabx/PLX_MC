import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

const maziusDisplay = localFont({
  src: [
    {
      path: "../../public/fonts/mazius/MaziusDisplay-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/mazius/MaziusDisplay-Italic.otf",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-mazius-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PLX Mission Control",
  description:
    "Agent-operated work hub for Petra Lab-X with a two-way SharePoint mirror as the system of record.",
  icons: {
    icon: [
      // SVG first (crisp at any size); the dark variant is picked via the media
      // query. PNGs remain as fallbacks for clients without SVG favicon support.
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      {
        url: "/brand/favicon-dark.svg",
        media: "(prefers-color-scheme: dark)",
        type: "image/svg+xml",
      },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: [{ url: "/brand/favicon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${maziusDisplay.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
