"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Holds a table that can be wider than a phone: it scrolls sideways inside
 * its frame, the page never does. While it scrolls, the keyboard can reach
 * it (and the arrow keys move it); while everything fits, it is not a stop
 * on the way through the page.
 */
export function ScrollX({
  label,
  className,
  ...props
}: ComponentProps<"div"> & {
  /** What is in here, for a screen reader: "Items of RF-1042". */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setScrolls(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      // `relative`: a visually hidden child must not stretch the page.
      className={cn("relative overflow-x-auto", className)}
      {...props}
    />
  );
}
