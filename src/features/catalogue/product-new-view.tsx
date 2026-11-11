"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { plural, translated } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { UploadProgress } from "./image-drop";
import type { SizeReader } from "./image-rules";
import { ProductForm } from "./product-form";
import { useCategories, useCreateProductWithImages } from "./queries";

export function ProductNewView({ readSize }: { readSize?: SizeReader }) {
  const router = useRouter();
  const create = useCreateProductWithImages();
  const [sending, setSending] = useState<{
    count: number;
    fraction: number;
  } | null>(null);
  // "New product" from a list filtered by a category starts in that category.
  const [{ categoryId }] = useUrlState({ categoryId: param.id() });
  const categories = useCategories();
  const known = categories.data?.items.some((entry) => entry.id === categoryId);

  return (
    <RequirePermission permission="catalog.manage">
      <PageHeader
        title="New product"
        back={{ href: routes.products, label: "Products" }}
        description="One product with its pack sizes. Each pack size gets its article number when it is saved and can take pictures of its own; more pack sizes can be added on its page later."
      />
      <PageBody className="max-w-4xl">
        {categoryId && categories.isLoading ? (
          // The category of the address is checked against the list first.
          <Skeleton className="h-80 rounded-lg" />
        ) : (
          <ProductForm
            categoryId={categoryId && known ? categoryId : undefined}
            onCancel={() => router.push(routes.products)}
            readSize={readSize}
            progress={
              sending ? (
                <UploadProgress
                  fraction={sending.fraction}
                  label={
                    sending.fraction < 1
                      ? `The product is created. Uploading ${plural(sending.count, "picture")}`
                      : "Uploaded. The API converts the pictures to WebP"
                  }
                />
              ) : null
            }
            onCreate={async (input, pictures) => {
              const count = pictures.reduce(
                (sum, entry) => sum + entry.files.length,
                0,
              );
              if (count > 0) setSending({ count, fraction: 0 });
              let result;
              try {
                result = await create.mutateAsync({
                  input,
                  pictures,
                  onProgress: (fraction) => setSending({ count, fraction }),
                });
              } finally {
                setSending(null);
              }
              const { product, uploads } = result;
              const name = translated(product.name);
              const stored = uploads
                .filter((entry) => entry.error === null)
                .reduce((sum, entry) => sum + entry.count, 0);
              const failed = uploads.filter((entry) => entry.error !== null);
              if (failed.length === 0) {
                const said =
                  stored > 0 ? `${plural(stored, "picture")} stored. ` : "";
                notify.success(
                  `${name} created`,
                  product.status === "active"
                    ? `${said}${plural(product.variants.length, "pack size")}. It is active.`
                    : `${said}${plural(product.variants.length, "pack size")}. It is a draft: set it active when it is ready.`,
                );
              } else {
                // The product exists; pictures are missing. Its page takes
                // them, so that is where the admin lands.
                notify.error(
                  failed[0]!.error,
                  stored > 0
                    ? `${name} created, but the pictures of ${failed.map((entry) => entry.label).join(", ")} were not stored`
                    : `${name} created without its pictures`,
                );
              }
              router.push(routes.product(product.id));
            }}
          />
        )}
      </PageBody>
    </RequirePermission>
  );
}
