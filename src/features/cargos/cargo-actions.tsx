"use client";

import { Ellipsis } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ActionButton } from "@/components/domain/permission";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { Cargo, CargoStatus } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney } from "@/lib/format/money";
import {
  CARGO_PATH,
  cargoActionLabel,
  sortTransitions,
} from "@/lib/status/transitions";
import { ActivatePaymentsDialog } from "./activate-payments-dialog";
import { CargoTransitionDialog } from "./cargo-transition-dialog";
import { useCargoPaymentSummary } from "./queries";

/**
 * What can be done with a cargo next. The buttons are exactly the
 * transitions the API allows (`allowedStatuses`): the next step is the one
 * blue button, a step back and the cancellation wait in the menu.
 */
export function CargoActions({
  cargo,
  variant = "header",
  menu,
}: {
  cargo: Cargo;
  /** `card`: only the next step, for the overview cards. */
  variant?: "header" | "card";
  /** More entries for the menu (edit, delete). */
  menu?: ReactNode;
}) {
  const can = useCan();
  const [target, setTarget] = useState<CargoStatus | null>(null);
  const [activating, setActivating] = useState(false);

  const steps = sortTransitions(
    CARGO_PATH,
    cargo.status,
    cargo.allowedStatuses,
  );
  const [next, ...alternatives] = steps.forward;
  const payments = useCargoPaymentSummary(
    cargo.status === "delivered" ? cargo.id : undefined,
  ).data;
  const toActivate = payments?.toActivate.orders ?? 0;
  const manage = can("cargos.manage");
  const hasMenu =
    variant === "header" &&
    (Boolean(menu) ||
      (manage && (steps.back.length > 0 || steps.aside.length > 0)));

  return (
    <>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-label="More actions for this cargo">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {menu}
            {manage &&
            menu &&
            (steps.back.length > 0 || steps.aside.length > 0) ? (
              <DropdownMenuSeparator />
            ) : null}
            {manage
              ? steps.back.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onSelect={() => setTarget(status)}
                  >
                    {cargoActionLabel(cargo.status, status)}
                  </DropdownMenuItem>
                ))
              : null}
            {manage
              ? steps.aside.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    danger={status === "cancelled"}
                    onSelect={() => setTarget(status)}
                  >
                    {cargoActionLabel(cargo.status, status)}
                  </DropdownMenuItem>
                ))
              : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {variant === "header"
        ? alternatives.map((status) => (
            <ActionButton
              key={status}
              permission="cargos.manage"
              onClick={() => setTarget(status)}
            >
              {cargoActionLabel(cargo.status, status)}
            </ActionButton>
          ))
        : null}

      {next ? (
        <ActionButton
          permission="cargos.manage"
          variant="primary"
          onClick={() => setTarget(next)}
        >
          {cargoActionLabel(cargo.status, next)}
        </ActionButton>
      ) : null}

      {toActivate > 0 ? (
        <ActionButton
          permission="payments.manage"
          variant="primary"
          onClick={() => setActivating(true)}
        >
          Activate payment
          <span className="font-normal tabular">
            {formatMoney(payments?.toActivate.amount ?? 0)}
          </span>
        </ActionButton>
      ) : null}

      <CargoTransitionDialog
        cargo={cargo}
        to={target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
      <ActivatePaymentsDialog
        cargo={cargo}
        open={activating}
        onOpenChange={setActivating}
      />
    </>
  );
}
