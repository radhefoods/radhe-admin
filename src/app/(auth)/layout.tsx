import type { ReactNode } from "react";
import { FeatherMark, Logo } from "@/components/shell/logo";

/** The frame of the pages before the panel: sign-in and the forced password change. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Logo height={40} />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <div className="edge-brand glass-panel animate-rise-in rounded-2xl p-6 sm:p-8">
            {children}
          </div>
        </div>
        <p className="text-xs text-ink-subtle">
          Radhe Foods back office. For the shop team only.
        </p>
      </main>

      <aside
        aria-hidden="true"
        className="relative m-3 hidden overflow-hidden rounded-3xl shadow-float hero-band lg:flex lg:flex-col lg:justify-between lg:p-12"
      >
        {/* Two glows of the feather that wander slowly behind the words. */}
        <span className="pointer-events-none absolute -top-28 -right-20 size-[26rem] animate-drift rounded-full bg-[radial-gradient(closest-side,rgb(var(--glow-cyan)/0.32),rgb(var(--glow-cyan)/0))]" />
        <span className="pointer-events-none absolute -bottom-36 -left-24 size-[30rem] animate-drift rounded-full bg-[radial-gradient(closest-side,rgb(var(--glow-gold)/0.2),rgb(var(--glow-gold)/0))] [animation-direction:alternate-reverse]" />
        <FeatherMark
          size={400}
          className="pointer-events-none absolute -right-28 -bottom-14 opacity-90 select-none"
        />
        <p className="relative text-xs font-semibold tracking-[0.18em] text-on-navy-subtle uppercase">
          Stock · Sell · Deliver
        </p>
        <div className="relative max-w-[26rem]">
          <p className="font-display text-4xl leading-[1.1] text-on-navy">
            Every order, from the shelf to the door.
          </p>
          <ol className="mt-10 flex flex-col gap-3 text-sm text-on-navy-muted">
            {[
              [
                "Keep stock",
                "Every product has a count. What is on the shelf is what the shop sells.",
              ],
              [
                "Sell",
                "Customers pay at checkout. The payment confirms the order and issues the invoice.",
              ],
              [
                "Deliver",
                "Prepare, dispatch with a tracking number, deliver. Returns and refunds are decided here.",
              ],
            ].map(([title, text], index) => (
              <li
                key={title}
                className="flex gap-3 rounded-xl border border-on-navy/10 bg-on-navy/6 px-4 py-3.5 backdrop-blur-sm"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-on-navy-subtle/50 bg-on-navy/10 text-xs font-semibold text-on-navy tabular">
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
