"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/components/shell/theme";
import { TooltipProvider } from "@/components/ui/menu";
import { Toaster, notify } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { createQueryClient } from "@/lib/query/client";

/** Everything the pages share: theme, the query cache, who is signed in. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() =>
    createQueryClient({
      onUnhandledMutationError: (error) => notify.error(error),
    }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={250} skipDelayDuration={300}>
            {children}
          </TooltipProvider>
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
