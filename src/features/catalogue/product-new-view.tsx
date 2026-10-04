"use client";

import { useRouter } from "next/navigation";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Alert, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { ProductForm } from "./product-form";
import { useCategories, useCreateProduct } from "./queries";

export function ProductNewView() {
  const router = useRouter();
  const create = useCreateProduct();
  // "New product" from a list filtered by a category starts in that category.
  const [{ categoryId }] = useUrlState({ categoryId: param.id() });
  const categories = useCategories();
  const known = categories.data?.items.some((entry) => entry.id === categoryId);

  return (
    <RequirePermission permission="catalog.manage">
      <PageHeader
        title="New product"
        back={{ href: routes.products, label: "Products" }}
        description="One article in one pack size. It gets its article number when it is saved."
      />
      <PageBody className="max-w-4xl">
        <Alert tone="info" title="Pictures and further pack sizes come next">
          Pictures can only be uploaded to a product that exists. Create the
          product first; its page then takes the pictures and lets you add the
          other pack sizes as copies.
        </Alert>
        {categoryId && categories.isLoading ? (
          // The category of the address is checked against the list first.
          <Skeleton className="h-80 rounded-lg" />
        ) : (
          <ProductForm
            categoryId={categoryId && known ? categoryId : undefined}
            onCancel={() => router.push(routes.products)}
            onCreate={async (input) => {
              const product = await create.mutateAsync(input);
              notify.success(
                `${product.sku} created`,
                product.status === "active"
                  ? "It is active. Add its pictures now."
                  : "It is a draft. Add its pictures, then set it active.",
              );
              router.push(routes.product(product.id));
            }}
          />
        )}
      </PageBody>
    </RequirePermission>
  );
}
