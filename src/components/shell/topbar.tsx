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
import { CargoPill } from "./cargo-pill";
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
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur-sm sm:gap-3 sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open the navigation"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search"
        aria-keyshortcuts="/ Control+K Meta+K"
        className="flex h-[34px] min-w-0 items-center gap-2 rounded-md border border-line bg-sunken px-2.5 text-13 text-ink-subtle transition-colors hover:border-line-strong sm:w-80"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="hidden truncate sm:inline">
          Order number, customer email, product
        </span>
        <Kbd className="ml-auto hidden sm:inline-flex">/</Kbd>
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <CargoPill />
        <UserMenu />
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
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-text ring-offset-2 ring-offset-surface hover:ring-2 hover:ring-line-strong"
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
