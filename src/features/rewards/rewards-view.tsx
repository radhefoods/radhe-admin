"use client";

import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { AccountsTab } from "./accounts-tab";
import { LedgerTab } from "./ledger-tab";
import { OverviewTab } from "./overview-tab";
import { SettingsTab } from "./settings-tab";

const TABS = ["overview", "settings", "accounts", "ledger"] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  overview: "Overview",
  settings: "Settings",
  accounts: "Accounts",
  ledger: "Ledger",
};

/**
 * Points and rewards (30): one page, four tabs in the address. The rules
 * need `rewards.manage` to save; everything else is read with `rewards.read`.
 */
export function RewardsView() {
  const [state, setState] = useUrlState({
    tab: param.oneOfOr(TABS, "overview"),
  });
  return (
    <RequirePermission permission="rewards.read">
      <PageHeader
        title="Points & Rewards"
        description="Customers collect coins for delivered orders, the sign-up, referrals and published reviews, and redeem them at checkout for a percentage of the goods per coin. Every movement is a row of the ledger; the balance is its sum."
      />
      <PageBody>
        <Tabs
          value={state.tab}
          onValueChange={(value) => setState({ tab: value as Tab })}
        >
          <TabsList aria-label="Points and rewards" className="mb-4">
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
          <TabsContent value="accounts">
            <AccountsTab />
          </TabsContent>
          <TabsContent value="ledger">
            <LedgerTab />
          </TabsContent>
        </Tabs>
      </PageBody>
    </RequirePermission>
  );
}
