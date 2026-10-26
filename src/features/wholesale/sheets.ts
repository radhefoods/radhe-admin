import type { SheetCatalogue } from "@/features/catalogue/import-export-dialog";
import { api } from "@/lib/api/client";
import { invalidation } from "@/lib/api/query-keys";

/**
 * The sheets of the wholesale catalogue (25, section 7): the same flow and
 * screens as the retail import, with the wholesale endpoints and columns.
 * A product row is one SKU; the `stock` column sets the cartons on hand.
 */
export const WHOLESALE_SHEETS: SheetCatalogue = {
  kinds: {
    products: {
      label: "Wholesale products",
      one: "wholesale product",
      template: "/templates/wholesale-products-example.csv",
      key: "the article number (sku) of a SKU; a product by its slug (slug_en), or the slug its name would get, and a row without a SKU by its pack and carton",
      included:
        "Every wholesale product, one row per SKU, by slug and then by pack: texts in both languages, category, pack, packs per carton, whether the SKU is offered, the cartons on hand, VAT, status, availability, position, storage and food information. The product columns are repeated on every row of a product.",
      rules: [
        "One row per SKU. The rows of one product share slug_en (or name_en); its product columns are read from the first of them, the later rows need only their SKU columns.",
        "A new product needs name_en, category_slug, vat_rate, pack_value, pack_unit and units_per_carton on its first row; a further SKU of a new product needs a sku. All SKUs of a product are of one unit family, each pack with the same carton once, 20 at most.",
        "category_slug is the slug_en of a wholesale category: one that exists, or a row of the categories sheet of the same import.",
        "units_per_carton is 1 to 1000 packs. sku_enabled takes yes or no: no takes the SKU off the wholesale site while the product stays.",
        "stock is the cartons on hand: the opening count of a new SKU, the new count of an existing one (recorded in the stock history as an import); it may be negative. A blank cell leaves the stock as it is.",
        "vat_rate is the percent, 7 or 19. Lists use | between entries. An empty cell leaves a field as it is.",
        "sort_order is the position among the products of its category, 0 first; a new product without it goes last.",
        "The article number of an existing SKU and the pictures are never changed by an import.",
      ],
    },
    categories: {
      label: "Wholesale categories",
      one: "wholesale category",
      template: "/templates/wholesale-categories-example.csv",
      key: "the slug (slug_en); without one, the slug the name would get",
      included:
        "Every wholesale category in display order: names in both languages, addresses, descriptions, position and visibility.",
      rules: [
        "A new category needs name_en; everything else has a default.",
        "slug_en and slug_de are generated from the names when empty.",
        "sort_order is the position in the list, 0 first; is_visible takes yes or no. A hidden category and its products are not on the wholesale site.",
        "An empty cell leaves a field as it is. The picture of a category is never part of a sheet.",
      ],
    },
  },
  sheets: api.wholesaleSheets,
  permission: "wholesale.manage",
  invalidates: invalidation.wholesale,
  filePrefix: "radhe-wholesale",
};
