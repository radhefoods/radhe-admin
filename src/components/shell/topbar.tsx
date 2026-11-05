"use client";

import {
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  User,
} from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Kbd } from "@/components/ui/surface";
import { useAdmin, useAuth } from "@/lib/auth/auth-provider";
import { initials } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { useTheme, type ThemeChoice } from "./theme";

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Like the device", icon: Monitor },
];

export function Topbar({
  onOpenMenu,
  onOpenSearch,
}: {
  onOpenMenu: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <header className="topbar-veil sticky top-0 z-20 shrink-0 lg:pt-3 lg:pr-3">
      <div className="glass-panel flex h-14 items-center gap-2 px-3 max-lg:border-x-0 max-lg:border-t-0 max-lg:shadow-none sm:gap-3 sm:px-6 lg:rounded-2xl lg:px-4">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open the navigation"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-ink/6 hover:text-ink lg:hidden"
        >
          <Menu className="size-5" />
        </button>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          aria-keyshortcuts="/ Control+K Meta+K"
          className="group flex h-[34px] min-w-0 items-center gap-2 rounded-lg border border-line-strong bg-surface/60 px-2.5 text-13 text-ink-subtle shadow-card transition-[border-color,background-color,box-shadow,color] duration-150 hover:border-accent/40 hover:bg-surface hover:text-ink-muted hover:shadow-focus sm:w-80"
        >
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 transition-colors group-hover:text-accent-text"
          />
          <span className="hidden truncate sm:inline">
            Order number, customer email, product
          </span>
          <Kbd className="ml-auto hidden sm:inline-flex">/</Kbd>
        </button>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function UserMenu() {
  const admin = useAdmin();
  const { signOut } = useAuth();
  const { choice, setChoice } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account of ${admin.name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent bg-grad-accent text-xs font-bold text-accent-fg shadow-glow transition-[box-shadow,scale] duration-150 hover:scale-105 hover:shadow-glow-strong active:scale-95 data-[state=open]:shadow-glow-strong"
      >
        {initials(admin.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold text-ink">
            {admin.name}
          </p>
          <p className="truncate text-13 text-ink-muted">{admin.email}</p>
          <p className="mt-1 text-xs text-ink-subtle">{admin.role.name}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={routes.profile}>
            <User />
            Profile and security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {THEMES.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={(event) => {
              event.preventDefault();
              setChoice(value);
            }}
          >
            <Icon />
            {label}
            {choice === value ? (
              <Check className="ml-auto text-accent-text" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
