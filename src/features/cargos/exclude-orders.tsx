"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/controls";
import type { Id, OrderSummary } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { personName, plural } from "@/lib/format/names";

/**
 * The orders an action on a whole cargo would change, with the chance to
 * leave some out. The API works this way: everything except the named
 * exceptions (`excludeOrderIds`).
 */
export function ExcludeOrders({
  orders,
  excluded,
  onChange,
  action,
}: {
  /** The orders the action would change. */
  orders: OrderSummary[];
  excluded: ReadonlySet<Id>;
  onChange: (excluded: Set<Id>) => void;
  /** What happens to an included order: "dispatched". */
  action: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (orders.length === 0) return null;
  const left = orders.filter((order) => excluded.has(order.id)).length;

  function toggle(orderId: Id, include: boolean) {
    const next = new Set(excluded);
    if (include) next.delete(orderId);
    else next.add(orderId);
    onChange(next);
  }

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left text-13 font-medium text-ink hover:bg-sunken"
      >
        <span>
          {left === 0
            ? "Leave single orders out"
            : `${plural(left, "order")} left out`}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 text-ink-subtle transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <ul
          id={id}
          className="max-h-56 divide-y divide-line overflow-y-auto border-t border-line"
        >
          {orders.map((order) => {
            const included = !excluded.has(order.id);
            const checkboxId = `${id}-${order.id}`;
            return (
              <li
                key={order.id}
                className="flex items-center gap-3 px-3.5 py-2"
              >
                <Checkbox
                  id={checkboxId}
                  checked={included}
                  onCheckedChange={(checked) =>
                    toggle(order.id, checked === true)
                  }
                  aria-label={`${order.orderNumber} will be ${action}`}
                />
                <label
                  htmlFor={checkboxId}
                  className={cn(
                    "flex min-w-0 flex-1 items-baseline gap-2 text-13",
                    !included && "text-ink-subtle line-through",
                  )}
                >
                  <span className="font-semibold">{order.orderNumber}</span>
                  <span className="truncate text-ink-muted">
                    {personName(order.customer)}, {order.city}
                  </span>
                  <span className="ml-auto tabular">
                    {formatMoney(order.finalTotal)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
