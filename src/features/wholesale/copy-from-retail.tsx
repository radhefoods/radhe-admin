"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Thumb } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { useProducts } from "@/features/catalogue/queries";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import {
  WHOLESALE_RULES,
  type ProductSummary,
  type WholesaleProductDetail,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { translated } from "@/lib/format/names";
import { useCopyFromRetail, useWholesaleCategories } from "./queries";

interface Chosen {
  /** `false`: the pack size is left out of the copy. */
  included: boolean;
  /** Packs per carton, as typed. */
  units: string;
}

function unitsProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return "A whole number.";
  const value = Number(trimmed);
  if (
    value < WHOLESALE_RULES.unitsPerCartonMin ||
    value > WHOLESALE_RULES.unitsPerCartonMax
  ) {
    return `${WHOLESALE_RULES.unitsPerCartonMin} to ${WHOLESALE_RULES.unitsPerCartonMax.toLocaleString("en")}.`;
  }
  return null;
}

/**
 * "Copy from retail" (25, section 6): find a retail product, choose the
 * wholesale category and the cartons of its pack sizes, and the API makes
 * a one-time copy, a draft with its own pictures. The two are not linked
 * afterwards.
 */
export function CopyFromRetailDialog({
  open,
  onOpenChange,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopied: (product: WholesaleProductDetail) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open ? (
          <CopyForm onClose={() => onOpenChange(false)} onCopied={onCopied} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CopyForm({
  onClose,
  onCopied,
}: {
  onClose: () => void;
  onCopied: (product: WholesaleProductDetail) => void;
}) {
  const can = useCan();
  const searchId = useId();
  const categoryId = useId();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const search = useProducts(
    { q, limit: 8, sort: "name" },
    can("catalog.read") && q.length >= 2,
  );
  const categories = useWholesaleCategories().data?.items ?? [];
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [category, setCategory] = useState("");
  const [copyImages, setCopyImages] = useState(true);
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [touched, setTouched] = useState(false);
  const copy = useCopyFromRetail();

  function choose(found: ProductSummary) {
    setProduct(found);
    setChosen(
      Object.fromEntries(
        found.variants.map((variant) => [
          variant.id,
          { included: true, units: "1" },
        ]),
      ),
    );
  }

  const included = product
    ? product.variants.filter((variant) => chosen[variant.id]?.included)
    : [];
  const problems = included.map((variant) =>
    unitsProblem(chosen[variant.id]?.units ?? ""),
  );
  const ready =
    product !== null &&
    category !== "" &&
    included.length > 0 &&
    problems.every((problem) => problem === null);
  const notice = copy.error ? describeError(copy.error) : null;

  async function submit() {
    setTouched(true);
    if (!ready || !product) return;
    try {
      const created = await copy.mutateAsync({
        productId: product.id,
        categoryId: category,
        skus: included.map((variant) => ({
          packSize: {
            value: variant.packSize.value,
            unit: variant.packSize.unit,
          },
          unitsPerCarton: Number(chosen[variant.id]!.units.trim()),
        })),
        status: "draft",
        copyImages,
      });
      notify.success(
        `${translated(created.name)} copied`,
        "A draft in the wholesale catalogue, with its own pictures. Every SKU starts with a stock of 0.",
      );
      onCopied(created);
      onClose();
    } catch (error) {
      if (isSessionError(error)) return;
    }
  }

  return (
    <>
      <DialogHeader
        title="Copy from retail"
        description="A one-time copy of a retail product: its texts, pictures, VAT rate and food information become a wholesale draft with the cartons you choose. Afterwards the two are not linked."
      />
      <DialogBody>
        {!can("catalog.read") ? (
          <Alert tone="warning" title="The retail products cannot be searched">
            Finding a product to copy needs the permission “Catalogue: read”.
          </Alert>
        ) : product ? (
          <div className="flex items-center gap-3 rounded-lg border border-line p-3">
            <Thumb src={product.image?.sizes.small.url} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {translated(product.name)}
              </p>
              <p className="text-13 text-ink-muted">
                {product.brand ? `${product.brand} · ` : ""}
                {translated(product.category.name)}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setProduct(null);
                setChosen({});
              }}
            >
              Choose another
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor={searchId} className="text-13 font-medium text-ink">
              Retail product
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
              />
              <Input
                id={searchId}
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Name, article number or brand"
                autoComplete="off"
                className="pl-9"
              />
            </div>
            {q.length < 2 ? (
              <p className="text-13 text-ink-subtle">
                Type at least two characters.
              </p>
            ) : search.isPending ? (
              <p className="flex items-center gap-2 text-13 text-ink-muted">
                <Spinner /> Searching…
              </p>
            ) : search.isError ? (
              <p className="text-13 text-danger-fg">
                {describeError(search.error).message}
              </p>
            ) : search.data?.items.length === 0 ? (
              <p className="text-13 text-ink-muted">
                No retail product matches.
              </p>
            ) : (
              <ul
                aria-label="Retail products found"
                className="flex flex-col divide-y divide-line rounded-lg border border-line"
              >
                {search.data?.items.map((found) => (
                  <li key={found.id}>
                    <button
                      type="button"
                      onClick={() => choose(found)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken"
                    >
                      <Thumb src={found.image?.sizes.small.url} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {translated(found.name)}
                        </span>
                        <span className="block text-13 text-ink-subtle">
                          {found.variants
                            .map((variant) => variant.packSize.label)
                            .join(", ")}
                          {found.brand ? ` · ${found.brand}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {product ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={categoryId}
                className="text-13 font-medium text-ink"
              >
                Wholesale category
              </label>
              <Select
                id={categoryId}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-invalid={touched && category === "" ? true : undefined}
              >
                <option value="">Choose a category</option>
                {categories.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.isVisible
                      ? entry.name.en
                      : `${entry.name.en} (hidden)`}
                  </option>
                ))}
              </Select>
              {touched && category === "" ? (
                <p className="text-13 text-danger-fg">Choose a category.</p>
              ) : null}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-13 font-medium text-ink">
                Pack sizes and their cartons
              </legend>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {product.variants.map((variant, index) => {
                  const entry = chosen[variant.id] ?? {
                    included: true,
                    units: "1",
                  };
                  const problem =
                    entry.included && touched
                      ? unitsProblem(entry.units)
                      : null;
                  return (
                    <li
                      key={variant.id}
                      className="flex flex-wrap items-center gap-3 px-3 py-2"
                    >
                      <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-ink">
                        <Checkbox
                          checked={entry.included}
                          aria-label={`Include ${variant.packSize.label}`}
                          onCheckedChange={(checked) =>
                            setChosen({
                              ...chosen,
                              [variant.id]: {
                                ...entry,
                                included: checked === true,
                              },
                            })
                          }
                        />
                        <span className="font-medium">
                          {variant.packSize.label}
                        </span>
                        <span className="text-13 text-ink-subtle tabular">
                          {variant.sku}
                        </span>
                      </label>
                      <span className="flex items-center gap-2">
                        <Input
                          inputMode="numeric"
                          value={entry.units}
                          disabled={!entry.included}
                          aria-label={`Packs per carton of ${variant.packSize.label}`}
                          aria-invalid={problem ? true : undefined}
                          onChange={(event) =>
                            setChosen({
                              ...chosen,
                              [variant.id]: {
                                ...entry,
                                units: event.target.value,
                              },
                            })
                          }
                          className={cn("w-24 tabular", index === 0 && "")}
                        />
                        <span className="text-13 text-ink-subtle">
                          packs per carton
                        </span>
                      </span>
                      {problem ? (
                        <span className="basis-full text-13 text-danger-fg">
                          {problem}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {touched && included.length === 0 ? (
                <p className="text-13 text-danger-fg">
                  Include at least one pack size.
                </p>
              ) : (
                <p className="text-13 text-ink-subtle">
                  Each included pack size becomes a SKU with its carton. The
                  article numbers are generated; the stock starts at 0.
                </p>
              )}
            </fieldset>

            <label className="flex items-start gap-2.5 text-sm text-ink">
              <Checkbox
                checked={copyImages}
                onCheckedChange={(checked) => setCopyImages(checked === true)}
                className="mt-0.5"
              />
              <span>
                Copy the pictures
                <span className="block text-13 text-ink-muted">
                  As files of their own: deleting either product never touches
                  the other.
                </span>
              </span>
            </label>
            <p className="flex items-center gap-2 text-13 text-ink-muted">
              <Badge tone="neutral">Draft</Badge> The copy starts as a draft;
              set it active on its page once the cartons and the stock are
              right.
            </p>
          </>
        ) : null}

        {notice ? (
          <Alert tone="danger" title={notice.message}>
            {notice.technical || notice.requestId ? (
              <span className="font-mono text-2xs break-all">
                {notice.technical}
                {notice.requestId ? ` · Request ${notice.requestId}` : ""}
              </span>
            ) : null}
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          size="lg"
          onClick={onClose}
          disabled={copy.isPending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={copy.isPending}
          disabled={!product}
          onClick={() => void submit()}
        >
          Copy as a wholesale draft
        </Button>
      </DialogFooter>
    </>
  );
}
