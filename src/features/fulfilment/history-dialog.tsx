"use client";

import { useState } from "react";
import { Pagination } from "@/components/data/pagination";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import type { FulfilmentAdjustment } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { AdjustmentList } from "./adjustment-list";
import { useFulfilmentAdjustments } from "./queries";

function Content({
  onTakeBack,
}: {
  onTakeBack: (adjustment: FulfilmentAdjustment) => void;
}) {
  const [page, setPage] = useState(1);
  const history = useFulfilmentAdjustments({ page });
  const mayAdjust = useCan()("orders.manage");
  return (
    <>
      <DialogHeader
        title="Adjustment history"
        description="Every adjustment made by hand, newest first. An entry is never changed or deleted: it is taken back by a second adjustment with the opposite numbers, and both stay here."
      />
      <DialogBody>
        {history.data ? (
          history.data.total === 0 ? (
            <EmptyState title="Nothing was adjusted by hand yet.">
              Every figure of the report comes from the orders and the returns.
            </EmptyState>
          ) : (
            <div
              className={cn(
                "flex flex-col gap-3",
                history.isPlaceholderData && "opacity-60 transition-opacity",
              )}
            >
              <AdjustmentList
                items={history.data.items}
                label="Adjustments, newest first"
                showProduct
                onTakeBack={mayAdjust ? onTakeBack : undefined}
              />
              <Pagination
                {...history.data}
                noun="adjustment"
                onPage={setPage}
              />
            </div>
          )
        ) : history.error && !isSessionError(history.error) ? (
          <Alert
            tone="danger"
            title="The history could not be loaded"
            actions={
              <Button onClick={() => void history.refetch()}>Try again</Button>
            }
          >
            {describeError(history.error).message}
          </Alert>
        ) : (
          <div
            aria-busy="true"
            aria-label="Loading the history"
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" size="lg">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/** "Adjustment history": all adjustments of the tracker (`GET …/adjustments`), in pages. */
export function HistoryDialog({
  open,
  onOpenChange,
  onTakeBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Take back" on an entry, with `orders.manage`: the form with the opposite numbers. */
  onTakeBack: (adjustment: FulfilmentAdjustment) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open ? <Content onTakeBack={onTakeBack} /> : null}
      </DialogContent>
    </Dialog>
  );
}
