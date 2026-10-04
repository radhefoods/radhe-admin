"use client";

import { useRouter } from "next/navigation";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { notify } from "@/components/ui/toast";
import { routes } from "@/lib/routes";
import { CargoForm, toCargoInput } from "./cargo-form";
import { useCreateCargo } from "./queries";

export function CargoNewView() {
  const router = useRouter();
  const create = useCreateCargo();

  return (
    <RequirePermission permission="cargos.manage">
      <PageHeader
        title="New cargo"
        back={{ href: routes.cargos, label: "Cargos" }}
        description="The cargo gets its number when it is saved."
      />
      <PageBody className="max-w-3xl">
        <CargoForm
          submitLabel="Create cargo"
          onCancel={() => router.push(routes.cargos)}
          onSubmit={async (values) => {
            const cargo = await create.mutateAsync(toCargoInput(values));
            notify.success(
              `${cargo.code} created`,
              cargo.status === "scheduled"
                ? "It opens by itself at its opening time."
                : "It is a draft until you schedule or open it.",
            );
            router.push(routes.cargo(cargo.id));
          }}
        />
      </PageBody>
    </RequirePermission>
  );
}
