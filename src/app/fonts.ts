import { Instrument_Sans, Instrument_Serif } from "next/font/google";

// Both families are downloaded when the panel is built and served from the
// panel's own address: no request goes to Google when an admin works.

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-instrument-sans",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-instrument-serif",
});
