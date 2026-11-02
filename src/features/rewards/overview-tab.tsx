"use client";

import { FigureTile, Section } from "@/features/analytics/kpi";
import type { RewardsSummary } from "@/lib/api/types";
import { useRewardsSummary } from "./queries";
import { signedCoins } from "./rules";

const count = (value: number) => value.toLocaleString("en");

const MOVEMENTS: {
  key: keyof RewardsSummary["last30Days"];
  label: string;
  explanation: string;
  /** Coins that left the accounts are shown with a minus. */
  negative?: boolean;
}[] = [
  {
    key: "earned",
    label: "Earned",
    explanation: "Deliveries, sign-ups, referrals and published reviews.",
  },
  {
    key: "redeemed",
    label: "Redeemed",
    explanation: "Spent on paid orders.",
    negative: true,
  },
  {
    key: "returned",
    label: "Returned",
    explanation: "Given back after goods were credited or an order cancelled.",
  },
  {
    key: "reversed",
    label: "Taken back",
    explanation:
      "Earned coins taken back: goods credited after the delivery, a referral void, a review gone.",
    negative: true,
  },
  {
    key: "adjusted",
    label: "Adjusted by hand",
    explanation: "What the team added or took, net.",
  },
  {
    key: "expired",
    label: "Expired",
    explanation: "Idle balances cleared by the expiry.",
    negative: true,
  },
];

/** The summary numbers (`GET /rewards/summary`): the accounts and the last 30 days. */
export function OverviewTab() {
  const summary = useRewardsSummary();
  const data = summary.data;
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Accounts"
        description="One account per customer, made on first use. Reserved coins are held by orders that wait for their payment."
        loading={!data}
        error={summary.error}
        onRetry={() => void summary.refetch()}
      >
        {data ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FigureTile label="Accounts" value={count(data.accounts)} />
            <FigureTile
              label="With a balance"
              value={count(data.accountsWithBalance)}
              detail={
                data.accounts > 0
                  ? `${Math.round((data.accountsWithBalance / data.accounts) * 100)} % of the accounts`
                  : undefined
              }
            />
            <FigureTile
              label="Coins outstanding"
              value={count(data.coinsOutstanding)}
              detail="Spendable now, across every account"
            />
            <FigureTile
              label="Coins reserved"
              value={count(data.coinsReserved)}
              detail="Held by unpaid orders"
              tone={data.coinsReserved > 0 ? "attention" : undefined}
            />
          </div>
        ) : null}
      </Section>

      <Section
        title="The last 30 days"
        description="Every movement of the ledger in the period, by kind."
        loading={!data}
        error={summary.error}
        onRetry={() => void summary.refetch()}
      >
        {data ? (
          <>
            <dl className="divide-y divide-line">
              {MOVEMENTS.map((movement) => {
                const value = data.last30Days[movement.key];
                return (
                  <div
                    key={movement.key}
                    className="flex items-baseline justify-between gap-4 py-2.5"
                  >
                    <dt className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium text-ink">
                        {movement.label}
                      </span>
                      <span className="text-13 text-ink-muted">
                        {movement.explanation}
                      </span>
                    </dt>
                    <dd className="font-display text-xl leading-none text-ink tabular">
                      {movement.key === "adjusted"
                        ? signedCoins(value)
                        : movement.negative && value > 0
                          ? `−${count(value)}`
                          : count(value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="text-13 text-ink-muted">
              {count(data.last30Days.ordersWithCoins)}{" "}
              {data.last30Days.ordersWithCoins === 1
                ? "order was"
                : "orders were"}{" "}
              paid partly with coins in the period.
            </p>
          </>
        ) : null}
      </Section>
    </div>
  );
}
