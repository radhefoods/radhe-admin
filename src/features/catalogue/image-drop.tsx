"use client";

import { ImagePlus } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { IMAGE_ACCEPT } from "./image-rules";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Where pictures are handed over: dropped from the desktop, or chosen with
 * the file dialog. It only collects the files; checking and uploading is
 * the caller's.
 */
export function ImageDrop({
  onFiles,
  inputLabel,
  multiple = true,
  disabled = false,
  compact = false,
  children,
  hint,
  className,
}: {
  onFiles: (files: File[]) => void;
  /** The name of the file field for screen readers: "Choose pictures to upload". */
  inputLabel: string;
  multiple?: boolean;
  disabled?: boolean;
  /** One line instead of a tall area. */
  compact?: boolean;
  /** The words before the button: "Drop pictures here, or". */
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Entering a child fires another dragenter: only the count says "outside".
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  // A file dropped next to the area would make the browser open it and leave
  // the page, with whatever was typed. While the area is there, it does not.
  useEffect(() => {
    const stay = (event: globalThis.DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer || !Array.from(transfer.types).includes("Files")) return;
      // An area that takes the files has answered already.
      if (event.defaultPrevented) return;
      event.preventDefault();
      transfer.dropEffect = "none";
    };
    window.addEventListener("dragover", stay);
    window.addEventListener("drop", stay);
    return () => {
      window.removeEventListener("dragover", stay);
      window.removeEventListener("drop", stay);
    };
  }, []);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <div
      onDragEnter={(event) => {
        if (!hasFiles(event) || disabled) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        // Without this the browser opens the file instead of handing it over.
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event) || disabled) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={onDrop}
      data-over={over || undefined}
      className={cn(
        "flex rounded-lg border border-dashed border-line-strong text-13 text-ink-muted transition-colors",
        compact
          ? "flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
          : "flex-col items-center gap-1.5 px-4 py-5 text-center",
        over && "border-accent bg-accent-soft text-ink",
        disabled && "opacity-60",
        className,
      )}
    >
      <ImagePlus
        aria-hidden="true"
        className={cn(
          "shrink-0 text-ink-subtle",
          compact ? "size-4" : "size-5",
          over && "text-accent-text",
        )}
      />
      <p className={cn(compact && "min-w-0 flex-1")}>
        {children}{" "}
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="rounded-xs font-semibold text-accent-text underline-offset-2 hover:underline disabled:no-underline"
        >
          {multiple ? "choose files" : "choose a file"}
        </button>
      </p>
      {hint ? (
        <p className={cn("text-xs text-ink-subtle", compact && "w-full")}>
          {hint}
        </p>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple={multiple}
        disabled={disabled}
        aria-label={inputLabel}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // The same file can be chosen again after a refusal.
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

/** How far an upload is: a bar, and the same in words. */
export function UploadProgress({
  fraction,
  label,
  className,
}: {
  /** 0 to 1 while the files travel; 1 while the API converts them. */
  fraction: number;
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-13">
        <span className="text-ink">{label}</span>
        <span className="text-ink-muted tabular">{percent} %</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
