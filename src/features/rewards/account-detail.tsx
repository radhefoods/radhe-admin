"use client";

import { Coins as CoinsIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/data/data-table";
import { customerOf } from "@/components/domain/customer";
import { ActionButton } from "@/components/domain/permission";
import { DateTime } from "@/components/domain/values";
import { SectionTitle } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { FigureTile } from "@/features/analytics/kpi";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { Id, RewardAccountDetail } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { personName, type PersonLike } from "@/lib/format/names";
import { pageFailed } from "@/lib/query/page-state";
import { routes, withQuery } from "@/lib/routes";
import { AdjustDialog } from "./adjust-dialog";
import { useRewardAccount } from "./queries";
import { coinsText } from "./rules";
import { TransactionCard, transactionColumns } from "./transaction-columns";

const columns = transactionColumns(["customer"]);
const count = (value: number) => value.toLocaleString("en");

/** The balance and the latest rows of one customer's account (30), with the adjustment by hand. */
export function AccountDetail({
  customerId,
  customer,
  /** In the narrow column of the customer page. */
  compact = false,
}: {
  customerId: Id;
  /** The customer as the page knows them; the account names them otherwise. */
  customer?: PersonLike | null;
  compact?: boolean;
}) {
  const detail = useRewardAccount(customerId);
  const [adjusting, setAdjusting] = useState(false);

  if (pageFailed(detail)) {
    return hasErrorCode(detail.error, "CUSTOMER_NOT_FOUND") ? (
      <EmptyState icon={<CoinsIcon />} title="This customer does not exist">
        The link may be old, or the address was mistyped.
      </EmptyState>
    ) : (
      <Alert
        tone="danger"
        title="The coins could not be loaded"
        actions={
          <Button onClick={() => void detail.refetch()}>Try again</Button>
        }
      >
        {errorMessage(detail.error)}
      </Alert>
    );
  }
  const data = detail.data;
  if (!data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  const name = personName(
    customer ?? customerOf(customerId, data.account.customer),
  );
  return (
    <div className="flex flex-col gap-6">
      <Balance data={data} compact={compact} />
      <section className="flex flex-col gap-3">
        <SectionTitle
          description="The latest 50 movements. The ledger has them all."
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={withQuery(routes.rewards, { tab: "ledger", customerId })}
                className="text-13 font-medium text-accent-text hover:underline"
              >
                In the ledger
              </Link>
              <ActionButton
                permission="rewards.manage"
                variant="secondary"
                size="sm"
                onClick={() => setAdjusting(true)}
              >
                Adjust coins
              </ActionButton>
            </span>
          }
        >
          History
        </SectionTitle>
        <DataTable
          caption={`Coin movements of ${name}`}
          columns={columns}
          data={data.transactions}
          getRowId={(row) => row.id}
          card={(row) => <TransactionCard row={row} />}
          className={cn(compact && "[&_th]:static [&>div]:overflow-x-auto")}
          empty={
            <EmptyState
              icon={<CoinsIcon />}
              title="No coins yet"
              className="py-10"
            >
              Coins arrive with the verified sign-up, a delivered order, a
              friend’s first delivered order and a published review, as the
              rules allow.
            </EmptyState>
          }
        />
      </section>
      <AdjustDialog
        customerId={customerId}
        account={data.account}
        name={name}
        open={adjusting}
        onOpenChange={setAdjusting}
      />
    </div>
  );
}

function Balance({
  data,
  compact,
}: {
  data: RewardAccountDetail;
  compact: boolean;
}) {
  const { account } = data;
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "grid gap-3",
          compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4",
        )}
      >
        <FigureTile
          label="Available"
          value={count(account.available)}
          detail={
            account.balance < 0
              ? `The exact balance is ${count(account.balance)}: coins were taken back and must be earned off.`
              : "Spendable at checkout"
          }
          tone={account.balance < 0 ? "danger" : undefined}
        />
        <FigureTile
          label="Reserved"
          value={count(account.reserved)}
          detail="Held by orders waiting for their payment"
          tone={account.reserved > 0 ? "attention" : undefined}
        />
        <FigureTile label="Earned in all" value={count(account.earnedTotal)} />
        <FigureTile
          label="Redeemed in all"
          value={count(account.redeemedTotal)}
        />
      </div>
      <p className="text-13 text-ink-muted">
        {account.lastActivityAt ? (
          <>
            Last movement <DateTime value={account.lastActivityAt} />.
          </>
        ) : (
          "No movement yet."
        )}{" "}
        {account.expiresAt ? (
          <>
            Without a movement the {coinsText(account.available)} expire on{" "}
            <DateTime value={account.expiresAt} />.
          </>
        ) : null}
      </p>
    </div>
  );
}
