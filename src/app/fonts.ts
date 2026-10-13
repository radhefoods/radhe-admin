import { Inter } from "next/font/google";

// One family for everything, downloaded when the panel is built and served
// from the panel's own address: no request goes to Google when an admin
// works. The optical-size axis sets the cut by size on its own: open and
// sturdy for 13 px table cells, tighter for titles and key figures.

export const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-inter",
});
