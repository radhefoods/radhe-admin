"use client";

import { Check } from "lucide-react";
import {
  DropdownMenu as MenuPrimitive,
  Popover as PopoverPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const surfaceClass =
  "z-50 rounded-lg border border-line bg-surface text-ink shadow-pop outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out";

// --- Dropdown menu ----------------------------------------------------------

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(surfaceClass, "min-w-44 p-1", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const itemClass =
  "flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-sunken data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle";

export function DropdownMenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        itemClass,
        danger &&
          "text-danger-fg data-[highlighted]:bg-danger-bg [&_svg]:text-danger-fg",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(itemClass, "pl-8", className)}
      {...props}
    >
      <span className="absolute left-3 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check className="size-4 text-accent-text" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn(
        "px-2.5 pt-2 pb-1 text-2xs font-semibold tracking-wider text-ink-subtle uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  );
}

// --- Popover ----------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(surfaceClass, "w-72 p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// --- Tooltip ----------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * A hint on hover and on keyboard focus. Wraps one element; a disabled
 * button is wrapped in a focusable span by the caller, so the hint is still
 * reachable.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: ComponentProps<typeof TooltipPrimitive.Content>["align"];
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-[60] max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug font-medium text-surface shadow-pop data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
