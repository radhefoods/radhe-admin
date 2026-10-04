"use client";

import { Check, Minus } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioGroupPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
} from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-xs border border-line-strong bg-surface shadow-card transition-colors",
        "hover:border-ink-subtle",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-line-strong transition-colors",
        "data-[state=checked]:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow-card transition-transform data-[state=checked]:translate-x-[18px] dark:bg-ink" />
    </SwitchPrimitive.Root>
  );
}

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

export function RadioItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface shadow-card",
        "hover:border-ink-subtle data-[state=checked]:border-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-accent" />
    </RadioGroupPrimitive.Item>
  );
}

// --- Tabs -------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "relative no-scrollbar flex gap-5 overflow-x-auto border-b border-line",
        className,
      )}
      {...props}
    />
  );
}

export const tabClass = cn(
  "relative -mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent text-sm font-medium whitespace-nowrap text-ink-muted transition-colors",
  "hover:text-ink",
  "data-[state=active]:border-accent data-[state=active]:text-ink",
  "aria-[current=page]:border-accent aria-[current=page]:text-ink",
);

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger className={cn(tabClass, className)} {...props} />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("outline-none", className)}
      {...props}
    />
  );
}
