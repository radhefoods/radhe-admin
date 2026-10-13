import type { ReactNode } from "react";
import { FeatherMark, Logo } from "@/components/shell/logo";

/** The frame of the pages before the panel: sign-in and the forced password change. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Logo height={40} />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children}
        </div>
        <p className="text-xs text-ink-subtle">
          Radhe Foods back office. For the shop team only.
        </p>
      </main>

      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden hero-band lg:flex lg:flex-col lg:justify-between lg:p-12"
      >
        <FeatherMark
          size={400}
          className="pointer-events-none absolute -right-28 -bottom-14 opacity-90 select-none"
        />
        <p className="text-xs font-semibold tracking-[0.18em] text-on-navy-subtle uppercase">
          Pre-order · Deliver · Collect
        </p>
        <div className="relative max-w-[26rem]">
          <p className="font-display text-4xl leading-[1.1] text-on-navy">
            Every cargo, from the first order to the last payment.
          </p>
          <ol className="mt-10 flex flex-col gap-4 text-sm text-on-navy-muted">
            {[
              [
                "Take orders",
                "One cargo is open. Customers confirm the full bill and pay nothing yet.",
              ],
              [
                "Deliver",
                "The cargo arrives, orders go out, what was really delivered is recorded.",
              ],
              [
                "Collect",
                "Payment is activated for the cargo. Reminders follow until the last order is paid.",
              ],
            ].map(([title, text], index) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-on-navy-subtle/50 text-xs font-semibold text-on-navy tabular">
                  {index + 1}
                </span>
                <span>
                  <span className="font-semibold text-on-navy">{title}.</span>{" "}
                  {text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
