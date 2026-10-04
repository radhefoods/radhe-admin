"use client";

import { useEffect } from "react";

/**
 * The last resort: the root layout itself failed, so nothing of the panel
 * (styles, fonts, providers) can be relied on. Plain markup with its own
 * colours, in both themes.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · Radhe Foods Admin</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="color-scheme" content="light dark" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          color: "CanvasText",
          background: "Canvas",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px" }}>
            The panel could not start
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, opacity: 0.8 }}>
            Nothing was saved or sent by this. Load the page again; if it keeps
            happening, tell the developer
            {error.digest ? ` and give the reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              height: 40,
              padding: "0 16px",
              border: 0,
              borderRadius: 6,
              font: "inherit",
              fontWeight: 600,
              color: "#ffffff",
              background: "#1a45cc",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
