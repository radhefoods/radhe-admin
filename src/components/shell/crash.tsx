"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * What a page shows when its code failed (not when the API refused: that is
 * handled where it happens). Nothing was changed by the crash itself, and the
 * admin gets one thing to do: try again.
 */
export function Crash({
  error,
  retry,
  className,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  className?: string;
}) {
  useEffect(() => {
    // The only place the stack is kept: the console of this browser.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-4 px-6 py-20 text-center",
        className,
      )}
    >
      <div className="flex max-w-md flex-col gap-1.5">
        <h1 className="font-display text-3xl text-ink">
          This page ran into a problem
        </h1>
        <p className="text-sm text-ink-muted">
          The fault is in the panel, not in what you did. Nothing was saved or
          sent by this. Try again; if it keeps happening, note what you were
          doing and tell the developer.
        </p>
        {error.digest ? (
          <p className="text-xs text-ink-subtle tabular">
            Reference {error.digest}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={retry}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Button
          onClick={() => {
            // A full load on purpose, not a client navigation: the broken
            // state of the page goes with it.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/");
          }}
        >
          To the start page
        </Button>
      </div>
    </div>
  );
}
