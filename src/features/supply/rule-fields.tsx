"use client";

import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { MoneyField, UnitField } from "@/components/form/fields";
import { PRICE_RULE_FIELDS, type PriceRuleField } from "@/lib/api/types";
import {
  RULE_FIELD_LABEL,
  RULE_SOURCE_LABEL,
  ruleValueText,
  type ResolvedRule,
} from "./pricing";

/**
 * The four values of the price rule a category or a product may set itself
 * (31). Each may stay empty; under an empty field stands the value that
 * counts instead and who sets it.
 */
export function RuleOverrideFields<T extends FieldValues>({
  form,
  names,
  inherited,
}: {
  form: UseFormReturn<T, unknown, FieldValues>;
  /** The name of each field in the form. */
  names: Record<PriceRuleField, FieldPath<T>>;
  /** What counts for a value left empty; `null` while it is not known. */
  inherited: ResolvedRule | null;
}) {
  const hint = (field: PriceRuleField) =>
    inherited
      ? `Empty: ${ruleValueText(field, inherited.rule[field])} from ${RULE_SOURCE_LABEL[inherited.sources[field]]}.`
      : "Empty: the value of the category or the shop counts.";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PRICE_RULE_FIELDS.map((field) =>
        field === "extraAmount" ? (
          <MoneyField
            key={field}
            form={form}
            name={names[field]}
            label={RULE_FIELD_LABEL[field]}
            optional
            placeholder={
              inherited
                ? ruleValueText(field, inherited.rule[field]).slice(1)
                : ""
            }
            hint={hint(field)}
          />
        ) : (
          <UnitField
            key={field}
            form={form}
            name={names[field]}
            label={RULE_FIELD_LABEL[field]}
            unit="%"
            decimal
            optional
            placeholder={
              inherited
                ? ruleValueText(field, inherited.rule[field]).replace(" %", "")
                : ""
            }
            hint={hint(field)}
          />
        ),
      )}
    </div>
  );
}
