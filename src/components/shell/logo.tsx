import { cn } from "@/lib/cn";

/**
 * The brand mark. The wordmark is navy and only works on light ground, so
 * the dark theme shows the feather alone with the name set in the serif
 * (the logo itself is never recoloured).
 */
export function Logo({
  className,
  height = 36,
}: {
  className?: string;
  /** The height of the mark in pixels. */
  height?: number;
}) {
  const width = Math.round((height * 1023) / 580);
  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ready-made sizes, no optimizer needed */}
      <img
        src="/brand/radhe-logo-240.webp"
        srcSet="/brand/radhe-logo-160.webp 160w, /brand/radhe-logo-240.webp 240w, /brand/radhe-logo-480.webp 480w"
        sizes={`${width}px`}
        width={width}
        height={height}
        alt="Radhe Foods"
        className="dark:hidden"
        style={{ height, width }}
      />
      <span className="hidden items-center gap-2 dark:inline-flex">
        <FeatherMark size={height} />
        <span
          className="font-display leading-none text-ink"
          style={{ fontSize: Math.round(height * 0.74) }}
        >
          Radhe
        </span>
        <span className="sr-only">Foods</span>
      </span>
    </span>
  );
}

/** The peacock feather of the logo, alone: works on light and on dark. */
export function FeatherMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ready-made sizes, no optimizer needed
    <img
      src="/brand/feather-128.webp"
      srcSet="/brand/feather-64.webp 64w, /brand/feather-128.webp 128w, /brand/feather-256.webp 256w, /brand/feather-442.webp 442w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      className={className}
      style={{ height: size, width: size }}
    />
  );
}
