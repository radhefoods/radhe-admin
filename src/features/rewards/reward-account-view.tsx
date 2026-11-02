"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { customerOf } from "@/components/domain/customer";
import { Can, RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/surface";
import { personName } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { AccountDetail } from "./account-detail";
import { useRewardAccount } from "./queries";

const back = {
  href: withQuery(routes.rewards, { tab: "accounts" }),
  label: "Accounts",
};

/** One customer's coins (30), reached from the account list. */
export function RewardAccountView() {
  const { customerId } = useParams<{ customerId: string }>();
  const detail = useRewardAccount(customerId);
  const account = detail.data?.account;
  return (
    <RequirePermission permission="rewards.read">
      <PageHeader
        back={back}
        title={
          account ? (
            `Coins of ${personName(customerOf(customerId, account.customer))}`
          ) : detail.isError ? (
            "Coins"
          ) : (
            <Skeleton className="h-9 w-64" />
          )
        }
        description={
          account
            ? "The balance of the account and the movements of its ledger."
            : undefined
        }
        actions={
          account ? (
            <Can permission="customers.read">
              <Button asChild variant="secondary">
                <Link href={routes.customer(customerId)}>The customer</Link>
              </Button>
            </Can>
          ) : null
        }
      />
      <PageBody>
        <AccountDetail customerId={customerId} />
      </PageBody>
    </RequirePermission>
  );
}
