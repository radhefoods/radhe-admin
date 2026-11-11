"use client";

import type { ReactNode } from "react";
import {
  BerlinDateTimeField,
  MoneyField,
  SwitchField,
  UnitField,
} from "@/components/form/fields";
import { TextField, useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { useFollowSaved } from "@/features/settings/queries";
import {
  SettingRow,
  SettingsFormCard,
} from "@/features/settings/settings-card";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { REWARDS_RULES, type RewardsSettings } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format/dates";
import { useNow } from "@/lib/hooks/use-now";
import { pageFailed } from "@/lib/query/page-state";
import { useRewardsSettings, useSaveRewardsSettings } from "./queries";
import { campaignState, redemptionExample } from "./rules";
import {
  rewardsSettingsSchema,
  settingsDefaults,
  toSettings,
} from "./settings-schema";

/** One group of rules inside the form, with its heading. */
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-13 text-ink-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

const asNumber = (value: string): number | null => {
  const text = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
};

function RewardsSettingsForm({ saved }: { saved: RewardsSettings }) {
  const defaults = settingsDefaults(saved);
  const form = useZodForm(rewardsSettingsSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSaveRewardsSettings();
  const now = useNow();
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    try {
      const result = await save.mutateAsync(toSettings(values));
      form.reset(settingsDefaults(result));
      notify.success(
        "Rules of the program saved",
        result.enabled
          ? "Customers earn and redeem coins by these rules."
          : "The program is off: nothing is earned or redeemed, balances stay.",
      );
    } catch (error) {
      // The API checks the period of the campaign: the end field says so.
      if (hasErrorCode(error, "REWARDS_SETTINGS_INVALID")) {
        form.setError(
          "earning.campaign.endsAt",
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
        return;
      }
      throw error;
    }
  });

  const values = form.watch();
  const percent = asNumber(values.redemption.percentPerCoin);
  const example =
    percent !== null && percent > 0 ? redemptionExample(percent) : null;
  const campaign = campaignState(saved.earning.campaign, now.getTime());

  return (
    <SettingsFormCard
      title="Rules of the program"
      description="Everything the shop does with coins follows these rules, from the moment they are saved. The whole document is saved at once."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the rules"
      permission="rewards.manage"
      className="max-w-4xl"
    >
      <Group
        title="The program"
        description="Off: nothing is earned or redeemed from that moment on. Balances stay and are shown to the customers."
      >
        <SwitchField
          form={form}
          name="enabled"
          label="The program is on"
          hint="Customers collect coins and redeem them at checkout."
        />
        {!saved.enabled ? (
          <Alert tone="info" title="The program is off">
            Nothing is earned or redeemed until it is switched on and saved. Set
            the welcome and the review coins first: both are 0 in the defaults.
          </Alert>
        ) : null}
      </Group>

      <Group
        title="Earning"
        description="Each rule has its own switch. Guests have no coins; nothing is earned before a delivery."
      >
        <SettingRow explanation="Given when the order is delivered, on the goods paid for after the discount code and the coins redeemed, delivery excluded, rounded to the nearest coin: €51.78 are 52 coins at one coin per euro.">
          <div className="flex flex-col gap-3">
            <SwitchField
              form={form}
              name="earning.order.enabled"
              label="Delivered orders earn coins"
            />
            <UnitField
              form={form}
              name="earning.order.coinsPerEuro"
              label="Coins per euro"
              unit="per €"
              decimal
              hint={`0 to ${REWARDS_RULES.coinsPerEuroMax.toLocaleString("en")}, up to ${REWARDS_RULES.coinsPerEuroDecimals} decimals.`}
              disabled={!values.earning.order.enabled}
            />
          </div>
        </SettingRow>
        <SettingRow explanation="Once per email address, after the verified sign-up, spendable at once, including on the first order.">
          <div className="flex flex-col gap-3">
            <SwitchField
              form={form}
              name="earning.welcome.enabled"
              label="The sign-up earns coins"
            />
            <UnitField
              form={form}
              name="earning.welcome.coins"
              label="Coins for signing up"
              unit="coins"
              disabled={!values.earning.welcome.enabled}
            />
          </div>
        </SettingRow>
        <SettingRow explanation="The inviter gets theirs when the invited person's first order is delivered; the invited person may get some too. Once per referral, taken back when the referral is void.">
          <div className="flex flex-col gap-3">
            <SwitchField
              form={form}
              name="earning.referral.inviter.enabled"
              label="The inviter earns coins"
            />
            <UnitField
              form={form}
              name="earning.referral.inviter.coins"
              label="Coins for the inviter"
              unit="coins"
              disabled={!values.earning.referral.inviter.enabled}
            />
            <SwitchField
              form={form}
              name="earning.referral.invitee.enabled"
              label="The invited person earns coins"
            />
            <UnitField
              form={form}
              name="earning.referral.invitee.coins"
              label="Coins for the invited person"
              unit="coins"
              disabled={!values.earning.referral.invitee.enabled}
            />
          </div>
        </SettingRow>
        <SettingRow explanation="When the review is published here, once per order review. Taken back when the review is rejected or deleted afterwards.">
          <div className="flex flex-col gap-3">
            <SwitchField
              form={form}
              name="earning.review.enabled"
              label="A published review earns coins"
            />
            <UnitField
              form={form}
              name="earning.review.coins"
              label="Coins per review"
              unit="coins"
              disabled={!values.earning.review.enabled}
            />
          </div>
        </SettingRow>
        <SettingRow
          explanation={
            <>
              Multiplies the order coins while it runs. Without dates it runs as
              long as it is on.{" "}
              {campaign === "running"
                ? "It runs now."
                : campaign === "scheduled" && saved.earning.campaign.startsAt
                  ? `It starts on ${formatDateTime(saved.earning.campaign.startsAt)}.`
                  : campaign === "over" && saved.earning.campaign.endsAt
                    ? `It ended on ${formatDateTime(saved.earning.campaign.endsAt)}.`
                    : campaign === "open"
                      ? "It runs now, without an end."
                      : ""}
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <SwitchField
              form={form}
              name="earning.campaign.enabled"
              label="Campaign"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <UnitField
                form={form}
                name="earning.campaign.multiplier"
                label="Multiplier"
                unit="×"
                decimal
                hint={`${REWARDS_RULES.multiplierMin} to ${REWARDS_RULES.multiplierMax}.`}
                disabled={!values.earning.campaign.enabled}
              />
              <TextField
                form={form}
                name="earning.campaign.name"
                label="Name"
                optional
                maxLength={80}
                placeholder="Diwali double coins"
                disabled={!values.earning.campaign.enabled}
              />
              <BerlinDateTimeField
                form={form}
                name="earning.campaign.startsAt"
                label="Starts"
                optional
                disabled={!values.earning.campaign.enabled}
              />
              <BerlinDateTimeField
                form={form}
                name="earning.campaign.endsAt"
                label="Ends"
                optional
                disabled={!values.earning.campaign.enabled}
              />
            </div>
          </div>
        </SettingRow>
      </Group>

      <Group
        title="Redemption"
        description="A coin is worth a percentage of the goods it is redeemed on, after the discount code; the delivery fee is never reduced. An empty minimum or cap is off."
      >
        <SwitchField
          form={form}
          name="redemption.enabled"
          label="Coins can be redeemed at checkout"
        />
        <SettingRow
          explanation={
            example
              ? `${example.coins} coins = ${example.percent} % of the goods: ${example.onFifty} on €50.00 of goods. The same coins take more off a larger order.`
              : "Example: at 0.01 % per coin, 100 coins are 1 % of the goods."
          }
        >
          <UnitField
            form={form}
            name="redemption.percentPerCoin"
            label="Percent per coin"
            unit="%"
            decimal
            hint={`${REWARDS_RULES.percentPerCoinMin} to ${REWARDS_RULES.percentPerCoinMax}, up to ${REWARDS_RULES.percentPerCoinDecimals} decimals.`}
            disabled={!values.redemption.enabled}
          />
        </SettingRow>
        <SettingRow explanation="A customer below the minimum coins cannot redeem yet; a redemption worth less than the minimum value is refused; the goods of the cart must reach the minimum goods value.">
          <div className="grid gap-4 sm:grid-cols-2">
            <UnitField
              form={form}
              name="redemption.minCoins"
              label="Minimum coins"
              unit="coins"
              optional
              disabled={!values.redemption.enabled}
            />
            <MoneyField
              form={form}
              name="redemption.minRedeemValue"
              label="Minimum reward value"
              optional
              disabled={!values.redemption.enabled}
            />
            <MoneyField
              form={form}
              name="redemption.minOrderValue"
              label="Minimum goods value"
              optional
              disabled={!values.redemption.enabled}
            />
          </div>
        </SettingRow>
        <SettingRow explanation="The shop offers at most this many coins per order, and never more off than the maximum discount.">
          <div className="grid gap-4 sm:grid-cols-2">
            <UnitField
              form={form}
              name="redemption.maxCoinsPerOrder"
              label="Maximum coins per order"
              unit="coins"
              optional
              disabled={!values.redemption.enabled}
            />
            <MoneyField
              form={form}
              name="redemption.maxDiscount"
              label="Maximum discount per order"
              optional
              disabled={!values.redemption.enabled}
            />
          </div>
        </SettingRow>
        <SwitchField
          form={form}
          name="redemption.combinableWithDiscountCodes"
          label="Coins combine with discount codes"
          hint="Off: a cart with a code cannot redeem coins."
          disabled={!values.redemption.enabled}
        />
      </Group>

      <Group
        title="Expiry"
        description="Off by default. On: the whole balance expires after the months without earning or spending; accounts with coins held by an open checkout wait."
      >
        <SwitchField
          form={form}
          name="expiry.enabled"
          label="Idle balances expire"
        />
        <UnitField
          form={form}
          name="expiry.inactivityMonths"
          label="Months without a movement"
          unit="months"
          fieldClassName="max-w-xs"
          disabled={!values.expiry.enabled}
        />
      </Group>
    </SettingsFormCard>
  );
}

/** The rules of the program (`GET`/`PUT /rewards/settings`), one form. */
export function SettingsTab() {
  const settings = useRewardsSettings();
  if (pageFailed(settings)) {
    return (
      <Alert
        tone="danger"
        title="The rules could not be loaded"
        actions={
          <Button onClick={() => void settings.refetch()}>Try again</Button>
        }
      >
        {errorMessage(settings.error)}
      </Alert>
    );
  }
  if (!settings.data) return <Skeleton className="h-96 max-w-4xl rounded-lg" />;
  return <RewardsSettingsForm saved={settings.data} />;
}
