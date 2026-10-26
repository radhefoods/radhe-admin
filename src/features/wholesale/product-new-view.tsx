"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type { SizeReader } from "@/features/catalogue/image-rules";
import { NewProductPictures } from "@/features/catalogue/new-product-pictures";
import { plural, translated } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { ProductForm } from "./product-form";
import { useCreateWholesaleProduct, useWholesaleCategories } from "./queries";

export function ProductNewView({ readSize }: { readSize?: SizeReader }) {
  const router = useRouter();
  const create = useCreateWholesaleProduct();
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<{ fraction: number } | null>(null);
  // "New product" from a list filtered by a category starts in that category.
  const [{ categoryId }] = useUrlState({ categoryId: param.id() });
  const categories = useWholesaleCategories();
  const known = categories.data?.items.some((entry) => entry.id === categoryId);

  return (
    <RequirePermission permission="wholesale.manage">
      <PageHeader
        title="New wholesale product"
        back={{ href: routes.wholesaleProducts, label: "Wholesale products" }}
        description="One product with its SKUs and pictures. Each SKU gets its article number when it is saved; more can be added on its page later."
      />
      <PageBody className="max-w-4xl">
        {categoryId && categories.isLoading ? (
          <Skeleton className="h-80 rounded-lg" />
        ) : (
          <ProductForm
            categoryId={categoryId && known ? categoryId : undefined}
            onCancel={() => router.push(routes.wholesaleProducts)}
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
                  `${translated(product.name)} created`,
                  product.status === "active"
                    ? `${pictures}${plural(product.skus.length, "SKU")}. It is on the wholesale site.`
                    : `${pictures}${plural(product.skus.length, "SKU")}. It is a draft: set it active when it is ready.`,
                );
              } else {
                notify.error(
                  upload,
                  `${translated(product.name)} created without its pictures`,
                );
              }
              router.push(routes.wholesaleProduct(product.id));
            }}
          />
        )}
      </PageBody>
    </RequirePermission>
  );
}
