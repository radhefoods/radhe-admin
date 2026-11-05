import Link from "next/link";
import { FeatherMark } from "@/components/shell/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <FeatherMark size={56} />
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl text-ink">
          This page does not exist
        </h1>
        <p className="text-ink-muted">
          The address may be mistyped, or the record was deleted.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-md bg-accent bg-grad-accent px-4 text-sm font-semibold text-accent-fg shadow-glow transition-[box-shadow,translate] duration-150 hover:-translate-y-px hover:shadow-glow-strong"
      >
        To the start page
      </Link>
    </div>
  );
}
