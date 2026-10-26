"use client";

import { Boxes, Ellipsis, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { PageHeader, gutter } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { ImageManager } from "@/features/catalogue/image-manager";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { WholesaleProductDetail } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { ProductForm } from "./product-form";
import {
  useDeleteWholesaleProduct,
  useWholesaleProduct,
  wholesaleImages,
} from "./queries";
import { cartonsText, overviewState } from "./rules";
import { StockHistoryCard } from "./stock-history";

/** The parts of the page, for jumping to one. */
const PARTS: { id: string; label: string; aside?: boolean }[] = [
  { id: "basics", label: "Basics" },
  { id: "skus", label: "SKUs and cartons" },
  { id: "status", label: "Status" },
  { id: "texts", label: "Texts" },
  { id: "food", label: "Food information" },
  { id: "search", label: "Search and address" },
  { id: "pictures", label: "Pictures", aside: true },
  { id: "stock-history", label: "Stock history", aside: true },
];

function Record({ product }: { product: WholesaleProductDetail }) {
  return (
    <Card aria-label="Record">
      <CardHeader title="Record" description="All times are German time." />
      <CardBody>
        <dl className="grid grid-cols-2 gap-4">
          <Fact label="Created">
            <DateTime value={product.createdAt} />
          </Fact>
          <Fact label="Last changed">
            <DateTime value={product.updatedAt} />
          </Fact>
          <Fact label="First active">
            {product.publishedAt ? (
              <DateTime value={product.publishedAt} />
            ) : (
              <span className="text-ink-subtle">Never</span>
            )}
          </Fact>
          <Fact label="Copied from retail">
            {product.retailProductId ? (
              <a
                href={routes.product(product.retailProductId)}
                className="text-accent-text hover:underline"
              >
                Open the retail product
              </a>
            ) : (
              <span className="text-ink-subtle">No</span>
            )}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

/** One wholesale product: its form with the SKU table, its pictures and its stock history. */
export function ProductView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [gone, setGone] = useState(false);
  const product = useWholesaleProduct(id, !removing && !gone);
  const remove = useDeleteWholesaleProduct();
  const back = { href: routes.wholesaleProducts, label: "Wholesale products" };

  if (product.isError && !gone) {
    return (
      <RequirePermission permission="wholesale.read">
        <PageHeader title="Wholesale product" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            product.error,
            "WHOLESALE_PRODUCT_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState icon={<Boxes />} title="This product does not exist">
              It may have been deleted. Quotations that named it keep their own
              copy of the lines.
            </EmptyState>
          ) : (
            <Alert
              tone="danger"
              title="The product could not be loaded"
              actions={
                <Button onClick={() => void product.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(product.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }

  const data = product.data;
  if (!data || gone) {
    return (
      <RequirePermission permission="wholesale.read">
        <PageHeader title={<Skeleton className="h-9 w-64" />} back={back} />
        <div
          className={cn(
            gutter,
            "grid items-start gap-6 pb-12 xl:grid-cols-[minmax(0,1fr)_24rem]",
          )}
        >
          <div className="flex flex-col gap-6">
            <Skeleton className="h-72 rounded-lg" />
            <Skeleton className="h-72 rounded-lg" />
          </div>
          <div className="flex flex-col gap-6">
            <Skeleton className="h-56 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        </div>
      </RequirePermission>
    );
  }

  const manage = can("wholesale.manage");
  const name = translated(data.name);
  const stock = overviewState(data.stock);

  return (
    <RequirePermission permission="wholesale.read">
      <PageHeader
        back={back}
        title={name}
        badges={
          <>
            <StatusBadge kind="product" value={data.status} />
            {data.isAvailable ? null : (
              <Badge tone="neutral">Unavailable</Badge>
            )}
            {stock ? <Badge tone={stock.tone}>{stock.label}</Badge> : null}
          </>
        }
        description={
          <>
            {plural(data.skuCount, "SKU")}: {cartonsText(data.skus)}
            {" · "}
            {translated(data.category.name)}
            {" · "}
            <span className="tabular">{data.stock.quantity}</span> cartons on
            hand
          </>
        }
        className="pb-2"
        actions={
          manage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="More actions for this product">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem danger onSelect={() => setDeleting(true)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      <nav
        aria-label="Parts of this page"
        className={cn(
          gutter,
          "mb-4 no-scrollbar flex items-center gap-x-4 overflow-x-auto text-13",
        )}
      >
        <span aria-hidden="true" className="shrink-0 text-ink-subtle">
          Jump to
        </span>
        {PARTS.map((part) => (
          <a
            key={part.id}
            href={`#${part.id}`}
            className={cn(
              "shrink-0 rounded-xs font-medium whitespace-nowrap text-ink-muted underline-offset-4 hover:text-ink hover:underline",
              part.aside && "xl:hidden",
            )}
          >
            {part.label}
          </a>
        ))}
      </nav>
      <div
        className={cn(
          gutter,
          "grid items-start gap-6 pb-12 xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]",
        )}
      >
        <ProductForm product={data} />
        <aside
          aria-label="Pictures and stock history"
          className="flex min-w-0 flex-col gap-6"
        >
          <ImageManager product={data} target={wholesaleImages(data.id)} />
          <StockHistoryCard product={data} paused={removing} />
          <Record product={data} />
        </aside>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${name} for good?`}
        description="The product with its SKUs and pictures is removed and cannot be brought back. Quotations that name it keep their own copy of every line; its stock history goes."
        facts={[
          { label: "SKUs", value: cartonsText(data.skus) },
          { label: "Pictures", value: data.images.length },
          { label: "Cartons on hand", value: data.stock.quantity },
        ]}
        confirmLabel="Delete the product"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          setRemoving(true);
          try {
            await remove.mutateAsync(data.id);
          } catch (error) {
            setRemoving(false);
            throw error;
          }
          notify.success(`${name} deleted`);
          setGone(true);
          router.replace(routes.wholesaleProducts);
        }}
      />
    </RequirePermission>
  );
}
