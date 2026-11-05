"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CountBadge } from "@/components/ui/badge";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { Logo } from "./logo";
import { isActive, visibleNavigation } from "./nav";

/** What waits for a person, for the counts next to the entries. */
export function useAttention() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.attention,
    queryFn: ({ signal }) => api.attention.get(signal),
    enabled: can("orders.read"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** The navigation, used by the fixed sidebar and by the drawer on small screens. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const can = useCan();
  const pathname = usePathname();
  const attention = useAttention().data;
  const groups = visibleNavigation(can);

  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((group, index) => (
        <div key={group.label ?? index} className="flex flex-col gap-0.5">
          {group.label ? (
            <p className="px-2.5 pb-1 text-2xs font-semibold tracking-wider text-ink-subtle uppercase">
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(item, pathname);
            const waiting = attention ? item.count?.(attention) : undefined;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
                  // The page in use: a tinted pane with a lit mark at its start.
                  active
                    ? "bg-accent-soft/80 text-ink shadow-card ring-1 ring-accent/15 before:absolute before:inset-y-2 before:-left-px before:w-[3px] before:rounded-full before:bg-grad-accent before:shadow-[0_0_10px_rgb(var(--glow-accent)/0.7)]"
                    : "text-ink-muted hover:bg-ink/5 hover:text-ink",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 transition-[color,scale] duration-150 group-hover:scale-110",
                    active
                      ? "text-accent-text"
                      : "text-ink-subtle group-hover:text-ink-muted",
                  )}
                />
                <span className="truncate">{item.label}</span>
                {waiting && waiting.count > 0 ? (
                  <>
                    <CountBadge
                      count={waiting.count}
                      tone={waiting.tone}
                      className="ml-auto"
                    />
                    <span className="sr-only">waiting</span>
                  </>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="glass-panel fixed inset-y-3 left-3 z-30 hidden w-60 flex-col overflow-hidden rounded-2xl lg:flex">
      <div className="flex h-16 shrink-0 items-center px-4">
        <Link href={routes.today} aria-label="Radhe Foods Admin, start page">
          <Logo height={32} />
        </Link>
      </div>
      <div
        aria-hidden="true"
        className="mx-4 h-px shrink-0 bg-grad-brand opacity-40"
      />
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-6">
        <SidebarNav />
      </div>
    </aside>
  );
}
