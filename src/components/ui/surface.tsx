import {
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  TriangleAlert,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A framed area on the work surface. No shadow: nothing floats here. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-13 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("h-4 skeleton", className)} />;
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-surface px-1 font-mono text-2xs text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

// --- Notices ----------------------------------------------------------------

const alertTones = {
  info: {
    box: "border-planned-dot/30 bg-planned-bg/50 text-ink",
    icon: "text-planned-fg",
    Icon: Info,
  },
  success: {
    box: "border-success-dot/30 bg-success-bg/60 text-ink",
    icon: "text-success-fg",
    Icon: CircleCheck,
  },
  // Something about time: a deadline, something that waits.
  time: {
    box: "border-gold-line bg-gold-soft text-ink",
    icon: "text-gold",
    Icon: Clock,
  },
  warning: {
    box: "border-gold-line bg-gold-soft text-ink",
    icon: "text-gold",
    Icon: TriangleAlert,
  },
  danger: {
    box: "border-danger-dot/30 bg-danger-bg/60 text-ink",
    icon: "text-danger-fg",
    Icon: CircleAlert,
  },
} as const;

export interface AlertProps extends Omit<ComponentProps<"div">, "title"> {
  tone?: keyof typeof alertTones;
  title?: ReactNode;
  actions?: ReactNode;
}

/** A notice inside the page. Errors are announced at once (`role="alert"`). */
export function Alert({
  tone = "info",
  title,
  actions,
  className,
  children,
  ...props
}: AlertProps) {
  const { box, icon, Icon } = alertTones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg border px-3.5 py-3 text-sm",
        box,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className="text-ink-muted [&_a]:font-medium [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        ) : null}
        {actions ? (
          <div className="mt-1.5 flex flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

// --- Empty and error states --------------------------------------------------

/** An empty list says what belongs here and what to do next. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-sunken text-ink-subtle [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children ? (
          <div className="text-13 text-ink-muted">{children}</div>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** A label with its value, for the facts of a record. */
export function Fact({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

/** Rows of label and value with a hairline between, as in a confirmation. */
export function FactRows({
  rows,
  className,
}: {
  rows: { label: ReactNode; value: ReactNode; strong?: boolean }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "divide-y divide-line overflow-hidden rounded-lg border border-line",
        className,
      )}
    >
      {rows.map((row, index) => (
        <div
          key={index}
          className="flex items-baseline justify-between gap-4 px-3.5 py-2.5"
        >
          <dt className="text-13 text-ink-muted">{row.label}</dt>
          <dd
            className={cn(
              "text-right font-semibold text-ink tabular",
              row.strong ? "text-lg" : "text-sm",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
