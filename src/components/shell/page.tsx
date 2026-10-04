import { ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The side gutter of every page of the panel. */
export const gutter = "px-4 sm:px-6 lg:px-8";

export interface PageHeaderProps {
  title: ReactNode;
  /** Next to the title: the status of the record. */
  badges?: ReactNode;
  description?: ReactNode;
  /** The list this record belongs to. */
  back?: { href: Route; label: string };
  /** The actions of the page; the primary one last. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  badges,
  description,
  back,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        gutter,
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-5 pb-4 sm:pt-7",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {back ? (
          <Link
            href={back.href}
            className="-ml-1 inline-flex items-center gap-0.5 self-start rounded-sm text-13 font-medium text-ink-muted hover:text-ink"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {back.label}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-[2rem]">
            {title}
          </h1>
          {badges}
        </div>
        {description ? (
          <p className="max-w-3xl text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** The body of a page under its header. */
export function PageBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(gutter, "flex flex-col gap-6 pb-12", className)}
      {...props}
    />
  );
}

/** A heading inside a page. */
export function SectionTitle({
  children,
  description,
  actions,
  className,
}: {
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{children}</h2>
        {description ? (
          <p className="mt-0.5 text-13 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
