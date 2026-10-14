"use client";

import { Archive, Ellipsis, ExternalLink, Package, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState, type Dispatch, type SetStateAction } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { PageHeader, gutter } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
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
import { env } from "@/config/env";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { ProductDetail } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { categoryPath } from "./category-tree";
import { ImageManager } from "./image-manager";
import { PackSizesPanel } from "./pack-sizes-panel";
import { PriceHistoryPanel } from "./price-history-panel";
import { ProductForm } from "./product-form";
import {
  useCategories,
  useDeleteProduct,
  useProduct,
  useUpdateProduct,
} from "./queries";

/**
 * The parts of the page, for jumping to one: the form is long. The parts
 * beside the form are listed only where they sit below it (narrow screens).
 */
const PARTS: { id: string; label: string; aside?: boolean }[] = [
  { id: "basics", label: "Basics" },
  { id: "price", label: "Pack size and price" },
  { id: "status", label: "Status and ordering" },
  { id: "texts", label: "Texts" },
  { id: "food", label: "Food information" },
  { id: "seo", label: "Search and SEO" },
  { id: "pictures", label: "Pictures", aside: true },
  { id: "pack-sizes", label: "Pack sizes", aside: true },
  { id: "price-history", label: "Price history", aside: true },
];

/** The address of a product in the customer shop. */
export function shopUrl(product: Pick<ProductDetail, "slug">): string {
  return `${env.shopUrl}/products/${product.slug.en}`;
}

/**
 * Where taking a product away stands:
 * `delete` asks before deleting; `active` and `in_use` explain why the API
 * does not delete it and offer to archive it instead; `in_use_archived` has
 * nothing left to offer; `archive` asks before archiving.
 */
export type Removal =
  "delete" | "active" | "in_use" | "in_use_archived" | "archive";

/**
 * What "Delete" leads to. The product says whether it can be deleted and
 * why not (8): an active one is never deleted, one that was in a cargo is
 * explained and archived instead, without asking the API first.
 */
export function removalFor(
  product: Pick<ProductDetail, "status" | "deletable" | "notDeletableReason">,
): Removal {
  if (product.status === "active") return "active";
  if (product.deletable === false) {
    if (product.notDeletableReason?.code === "PRODUCT_IN_USE") {
      return product.status === "archived" ? "in_use_archived" : "in_use";
    }
    if (product.notDeletableReason?.code === "PRODUCT_IS_ACTIVE") {
      return "active";
    }
  }
  return "delete";
}

/**
 * Deleting and archiving a product. The API only deletes drafts and
 * archived products that were never part of a cargo; what it refuses is
 * explained, with archiving as the way that always works.
 */
export function RemoveProduct({
  product,
  step,
  onStep,
  onDeleting,
  onDeleted,
}: {
  product: ProductDetail;
  step: Removal | null;
  onStep: Dispatch<SetStateAction<Removal | null>>;
  /** `true` while the API is asked to delete: the page stops loading the product. */
  onDeleting: (deleting: boolean) => void;
  onDeleted: () => void;
}) {
  const remove = useDeleteProduct();
  const update = useUpdateProduct(product.id);
  const label = `${translated(product.name)} ${product.packSize.label}`;
  /** Closes a dialog, unless the step has moved on in the meantime. */
  const closing = (from: Removal) => (open: boolean) => {
    if (!open) onStep((current) => (current === from ? null : current));
  };

  async function archive(): Promise<void> {
    await update.mutateAsync({ status: "archived" });
    notify.success(
      `${label} archived`,
      "It is out of the shop. Old orders and invoices keep it.",
    );
  }

  const refusal = step === "active" || step === "in_use" ? step : null;

  return (
    <>
      <ConfirmDialog
        open={step === "delete"}
        onOpenChange={closing("delete")}
        title={`Delete ${label} for good?`}
        description="The product and its pictures are removed and cannot be brought back. The API only deletes a product that was never part of a cargo."
        facts={[
          { label: "Article number", value: product.sku },
          { label: "Pictures", value: product.images.length },
          ...(product.packSizes.length > 1
            ? [
                {
                  label: "Other pack sizes",
                  value: `${product.packSizes.length - 1} stay`,
                },
              ]
            : []),
        ]}
        confirmLabel="Delete the product"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          onDeleting(true);
          try {
            await remove.mutateAsync(product.id);
          } catch (error) {
            onDeleting(false);
            if (hasErrorCode(error, "PRODUCT_IN_USE")) {
              onStep(
                product.status === "archived" ? "in_use_archived" : "in_use",
              );
              return;
            }
            if (hasErrorCode(error, "PRODUCT_IS_ACTIVE")) {
              onStep("active");
              return;
            }
            throw error;
          }
          notify.success(`${label} deleted`);
          onDeleted();
        }}
      />

      <ConfirmDialog
        open={refusal !== null}
        onOpenChange={(open) => {
          if (!open)
            onStep((current) => (current === refusal ? null : current));
        }}
        title={
          refusal === "in_use"
            ? `${label} cannot be deleted`
            : "An active product cannot be deleted"
        }
        description={
          refusal === "in_use"
            ? "It was part of a cargo, so orders and invoices may refer to it. Archive it instead: it leaves the shop and stays in the records."
            : "It is part of the shop. Archive it instead: it leaves the shop, and old orders and invoices keep it. An archived product that was never part of a cargo can be deleted afterwards."
        }
        facts={[{ label: "Article number", value: product.sku }]}
        confirmLabel="Archive instead"
        cancelLabel="Leave it as it is"
        onConfirm={archive}
      />

      <Dialog
        open={step === "in_use_archived"}
        onOpenChange={closing("in_use_archived")}
      >
        <DialogContent size="sm" hideClose>
          <DialogHeader
            title={`${label} cannot be deleted`}
            description="It was part of a cargo, so orders and invoices may refer to it. It is archived already: it is out of the shop and stays in the records. That is as far as it goes."
            className="pb-5"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button size="lg">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={step === "archive"}
        onOpenChange={closing("archive")}
        title={`Archive ${label}?`}
        description="It leaves the shop and can no longer be enabled in a cargo. Old orders and invoices keep it, and you can set it active again at any time."
        facts={[
          { label: "Article number", value: product.sku },
          { label: "Price", value: formatMoney(product.pricing.price) },
        ]}
        confirmLabel="Archive the product"
        onConfirm={archive}
      />
    </>
  );
}

function Record({ product }: { product: ProductDetail }) {
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
          <Fact label="Label in the shop">{product.packSize.label}</Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

/** One product: its form, its pictures, its pack sizes and its price history. */
export function ProductView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [gone, setGone] = useState(false);
  const product = useProduct(id, !deleting && !gone);
  const update = useUpdateProduct(id);
  const categories = useCategories().data?.items;
  const back = { href: routes.products, label: "Products" };

  if (product.isError && !gone) {
    return (
      <RequirePermission permission="catalog.read">
        <PageHeader title="Product" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            product.error,
            "PRODUCT_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState icon={<Package />} title="This product does not exist">
              It may have been deleted. Products that were part of a cargo are
              archived instead and stay in the list.
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
      <RequirePermission permission="catalog.read">
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

  const manage = can("catalog.manage");
  const name = translated(data.name);
  const path = categories ? categoryPath(categories, data.categoryId) : "";

  return (
    <RequirePermission permission="catalog.read">
      <PageHeader
        back={back}
        title={
          <>
            {name} <span className="text-ink-muted">{data.packSize.label}</span>
          </>
        }
        badges={
          <>
            <StatusBadge kind="product" value={data.status} />
            {data.isAvailable ? null : (
              <Badge tone="neutral">Unavailable</Badge>
            )}
            {data.pricing.onSale ? (
              <Badge tone="neutral">
                On sale
                {data.pricing.discountPercent !== null
                  ? `, −${data.pricing.discountPercent} %`
                  : ""}
              </Badge>
            ) : null}
          </>
        }
        description={
          <>
            <span className="tabular">{data.sku}</span>
            {" · "}
            {path || translated(data.category.name)}
            {data.packSizes.length > 1
              ? ` · one of ${plural(data.packSizes.length, "pack size")}`
              : ""}
          </>
        }
        className="pb-2"
        actions={
          <>
            {manage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    aria-label="More actions for this product"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {data.status === "archived" ? null : (
                    <DropdownMenuItem onSelect={() => setRemoval("archive")}>
                      <Archive />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    danger
                    onSelect={() => setRemoval(removalFor(data))}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {data.status === "active" ? (
              <Button asChild>
                <a href={shopUrl(data)} target="_blank" rel="noreferrer">
                  Open in the shop
                  <ExternalLink />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            ) : null}
          </>
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
        <ProductForm
          product={data}
          onUpdate={async (patch) => {
            const updated = await update.mutateAsync(patch);
            notify.success(`${updated.sku} saved`);
            return updated;
          }}
        />
        <aside
          aria-label="Pictures, pack sizes and history"
          className="flex min-w-0 flex-col gap-6"
        >
          <ImageManager product={data} />
          <PackSizesPanel product={data} />
          <PriceHistoryPanel product={data} paused={deleting} />
          <Record product={data} />
        </aside>
      </div>

      <RemoveProduct
        product={data}
        step={removal}
        onStep={setRemoval}
        onDeleting={setDeleting}
        onDeleted={() => {
          setGone(true);
          router.replace(routes.products);
        }}
      />
    </RequirePermission>
  );
}
