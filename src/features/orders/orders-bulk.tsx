"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Select, Textarea } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { invalidation } from "@/lib/api/query-keys";
import {
  DELIVERY_METHODS,
  type BulkChosenStatus,
  type BulkOrderResult,
  type DeliveryMethod,
  type Id,
  type OrderSummary,
} from "@/lib/api/types";
import { DELIVERY_METHOD_LABEL, plural } from "@/lib/format/names";

/** The forward steps of the normal way (documentation, 9). */
const STATUS_LABEL: Record<BulkChosenStatus, string> = {
  processing: "Mark processing",
  dispatched: "Mark dispatched",
  delivered: "Mark delivered",
};
const STATUSES = Object.keys(STATUS_LABEL) as BulkChosenStatus[];

type Action = { kind: "status"; status: BulkChosenStatus } | { kind: "method" };

interface Outcome {
  what: string;
  changed: number;
  results: BulkOrderResult[];
}

/**
 * The bar above the orders when some are ticked, and the dialogs behind
 * its buttons. The API takes the chosen orders and answers every one of
 * them (9): when any was left as it is, every order is listed with what
 * happened to it, nothing is hidden in a count.
 */
export function OrdersBulkBar({
  orders,
  selected,
  onClear,
}: {
  /** The rows on the page, for the numbers of the chosen orders. */
  orders: OrderSummary[];
  selected: ReadonlySet<Id>;
  onClear: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<DeliveryMethod>("radhe_delivery");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const noteId = useId();
  const pickId = useId();
  const ids = [...selected];
  const count = ids.length;

  const run = useMutation({
    mutationFn: async (chosen: Action): Promise<Outcome> => {
      const trimmed = note.trim() || undefined;
      if (chosen.kind === "status") {
        const result = await api.orders.bulkStatus({
          orderIds: ids,
          status: chosen.status,
          note: trimmed,
        });
        return {
          what: STATUS_LABEL[chosen.status].toLowerCase(),
          changed: result.changed,
          results: result.results,
        };
      }
      const result = await api.orders.bulkDeliveryMethod({
        orderIds: ids,
        method,
        note: trimmed,
      });
      return {
        what: `delivery by ${DELIVERY_METHOD_LABEL[method]}`,
        changed: result.changed,
        results: result.results,
      };
    },
    meta: { invalidates: invalidation.order, silent: true },
  });

  if (count === 0 && !outcome) return null;

  const refused = outcome?.results.filter((entry) => !entry.changed) ?? [];
  const numbers = orders
    .filter((order) => selected.has(order.id))
    .map((order) => order.orderNumber);

  return (
    <>
      {count > 0 ? (
        <div
          role="region"
          aria-label="Chosen orders"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/60 px-3 py-2 text-13"
        >
          <span className="font-semibold text-ink tabular">
            {plural(count, "order")} chosen
          </span>
          <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden="true" />
          {STATUSES.map((status) => (
            <ActionButton
              key={status}
              size="sm"
              permission="orders.manage"
              onClick={() => setAction({ kind: "status", status })}
            >
              {STATUS_LABEL[status]}
            </ActionButton>
          ))}
          <ActionButton
            size="sm"
            permission="orders.manage"
            onClick={() => setAction({ kind: "method" })}
          >
            Delivery method
          </ActionButton>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            className="ml-auto"
            icon={<X />}
          >
            Clear the choice
          </Button>
        </div>
      ) : null}

      {action ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
              setNote("");
            }
          }}
          title={
            action.kind === "status"
              ? `${STATUS_LABEL[action.status]}: ${plural(count, "order")}?`
              : `Change the delivery method of ${plural(count, "order")}?`
          }
          description={
            action.kind === "status"
              ? "Only orders on the normal way take the step: processing from confirmed, dispatched from confirmed or processing, delivered from dispatched. Dispatched and delivered customers are told. Every other order is left as it is and named afterwards."
              : "Tracking numbers of orders whose method changes are removed. A pending, cancelled or returned order is left as it is and named afterwards."
          }
          facts={[
            {
              label: "Orders",
              value:
                numbers.length <= 6
                  ? numbers.join(", ")
                  : `${numbers.slice(0, 6).join(", ")} and ${numbers.length - 6} more`,
            },
          ]}
          confirmLabel={
            action.kind === "status"
              ? STATUS_LABEL[action.status]
              : "Change the method"
          }
          onConfirm={async () => {
            const result = await run.mutateAsync(action);
            const left = result.results.length - result.changed;
            if (left === 0) {
              notify.success(
                `${plural(result.changed, "order")} changed`,
                `All chosen orders: ${result.what}.`,
              );
              onClear();
            } else {
              setOutcome(result);
            }
          }}
        >
          {action.kind === "method" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={pickId} className="text-13 font-medium text-ink">
                Delivery method
              </label>
              <Select
                id={pickId}
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as DeliveryMethod)
                }
              >
                {DELIVERY_METHODS.map((entry) => (
                  <option key={entry} value={entry}>
                    {DELIVERY_METHOD_LABEL[entry]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-13 font-medium text-ink">
              Note for the history
              <span className="ml-1.5 font-normal text-ink-subtle">
                optional
              </span>
            </label>
            <Textarea
              id={noteId}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-0"
            />
          </div>
        </ConfirmDialog>
      ) : null}

      <Dialog
        open={outcome !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOutcome(null);
            onClear();
          }
        }}
      >
        <DialogContent>
          {outcome ? (
            <>
              <DialogHeader
                title={`${plural(outcome.changed, "order")} changed, ${plural(refused.length, "order")} not`}
                description={`${outcome.what[0]?.toUpperCase()}${outcome.what.slice(1)}: the API answered every chosen order.`}
              />
              <DialogBody>
                <ul
                  aria-label="What happened to each chosen order"
                  className="flex flex-col divide-y divide-line text-13"
                >
                  {outcome.results.map((entry) => (
                    <li key={entry.orderId} className="flex gap-3 py-2">
                      <span className="w-20 shrink-0 font-semibold text-ink tabular">
                        {entry.orderNumber ?? "Unknown"}
                      </span>
                      {entry.changed ? (
                        <span className="flex items-center gap-1 text-success-fg">
                          <Check aria-hidden="true" className="size-3.5" />
                          Changed
                        </span>
                      ) : (
                        <span className="text-ink-muted">{entry.reason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Check />}
                  onClick={() => {
                    setOutcome(null);
                    onClear();
                  }}
                >
                  Understood
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
