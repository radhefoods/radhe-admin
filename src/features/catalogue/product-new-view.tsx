"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { plural } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import type { SizeReader } from "./image-rules";
import { NewProductPictures } from "./new-product-pictures";
import { ProductForm } from "./product-form";
import { useCategories, useCreateProductWithImages } from "./queries";

export function ProductNewView({ readSize }: { readSize?: SizeReader }) {
  const router = useRouter();
  const create = useCreateProductWithImages();
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<{ fraction: number } | null>(null);
  // "New product" from a list filtered by a category starts in that category.
  const [{ categoryId }] = useUrlState({ categoryId: param.id() });
  const categories = useCategories();
  const known = categories.data?.items.some((entry) => entry.id === categoryId);

  return (
    <RequirePermission permission="catalog.manage">
      <PageHeader
        title="New product"
        back={{ href: routes.products, label: "Products" }}
        description="One article in one pack size, with its pictures. It gets its article number when it is saved; further pack sizes are added on its page as copies."
      />
      <PageBody className="max-w-4xl">
        {categoryId && categories.isLoading ? (
          // The category of the address is checked against the list first.
          <Skeleton className="h-80 rounded-lg" />
        ) : (
          <ProductForm
            categoryId={categoryId && known ? categoryId : undefined}
            onCancel={() => router.push(routes.products)}
            alsoUnsaved={files.length > 0}
            pictures={
              <NewProductPictures
                files={files}
                onChange={setFiles}
                sending={sending}
                disabled={create.isPending}
                readSize={readSize}
              />
            }
            onCreate={async (input) => {
              if (files.length > 0) setSending({ fraction: 0 });
              let result;
              try {
                result = await create.mutateAsync({
                  input,
                  files,
                  onProgress: (fraction) => setSending({ fraction }),
                });
              } finally {
                setSending(null);
              }
              const { product, upload } = result;
              if (upload === null) {
                const pictures =
                  files.length > 0
                    ? `${plural(files.length, "picture")} stored. `
                    : "";
                notify.success(
                  `${product.sku} created`,
                  product.status === "active"
                    ? `${pictures}It is active.`
                    : `${pictures}It is a draft: set it active when it is ready.`,
                );
              } else {
                // The product exists; only its pictures are missing. Its page
                // takes them, so that is where the admin lands.
                notify.error(
                  upload,
                  `${product.sku} created without its pictures`,
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
