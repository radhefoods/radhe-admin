// The demo data of the mock: a shop in the middle of its week. Products
// with their stock, orders in every status from the open payment page to
// the delivered parcel, returns, refunds waiting for a decision, failed
// messages. Dates are relative to "now", so the data is always current;
// the same seed always gives the same shop.

import type {
  AdminImage,
  Customer,
  DeliveryMethod,
  PackUnit,
  Refund,
  Role,
  StorageType,
} from "../src/lib/api/types/index.ts";
import type {
  AdminRecord,
  BannerRecord,
  CategoryRecord,
  Db,
  MockConfig,
  OrderRecord,
  ProductRecord,
  VariantRecord,
} from "./db.ts";
import { emptyDb } from "./db.ts";
import {
  deliveryFeeFor,
  issueCreditNote,
  packLabel,
  pushHistory,
  queueMessage,
  recomputeFinal,
  totalsOf,
  vatOf,
} from "./domain.ts";
import { newId } from "./http.ts";
import { seedBlog } from "./modules/blog.ts";
import { seedFaq } from "./modules/faq.ts";
import {
  discountShares,
  reserveDiscountUse,
  seedDiscountCodes,
  type DiscountCodeRecord,
} from "./modules/discounts.ts";
import { seedQuotations } from "./modules/quotations.ts";
import { seedWholesale } from "./modules/wholesale.ts";
import { completeRefund } from "./modules/payments.ts";
import {
  recordMovement,
  releaseUnits,
  restockReturn,
} from "./modules/stock.ts";
import {
  cancelOrder,
  failPayment,
  setOrderStatus,
  settleOrder,
} from "./order-ops.ts";
import { DAY, HOUR, berlinDay, iso } from "./time.ts";

export const ALL_PERMISSIONS = [
  "admin_users.read",
  "admin_users.manage",
  "roles.read",
  "roles.manage",
  "customers.read",
  "customers.manage",
  "catalog.read",
  "catalog.manage",
  "orders.read",
  "orders.manage",
  "settings.read",
  "settings.manage",
  "legal.read",
  "legal.manage",
  "payments.read",
  "payments.manage",
  "notifications.read",
  "notifications.manage",
  "analytics.read",
  "content.read",
  "content.manage",
  "quotations.read",
  "quotations.manage",
  "wholesale.read",
  "wholesale.manage",
  "discounts.read",
  "discounts.manage",
];

/** The sign-ins of the demo. Every admin also accepts the code 000000. */
export const DEMO_ADMINS = {
  owner: { email: "owner@radhefoods.de", password: "radhe-owner-2026" },
  orders: { email: "orders@radhefoods.de", password: "radhe-orders-2026" },
  viewer: { email: "viewer@radhefoods.de", password: "radhe-viewer-2026" },
  /** First sign-in: authenticator setup, then the forced password change. */
  newcomer: { email: "new@radhefoods.de", password: "temporary-pass-123" },
  disabled: { email: "former@radhefoods.de", password: "radhe-former-2026" },
} as const;

/** A small, fast, repeatable random source. */
function random(seed: number) {
  let state = seed;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(list: readonly T[]): T =>
      list[Math.floor(next() * list.length)] as T,
    chance: (probability: number) => next() < probability,
  };
}

export function placeholderImage(
  publicUrl: string,
  id: string,
  label: string,
  hue: number,
  uploadedAt: string,
  alt: { en?: string | null; de?: string | null },
): AdminImage {
  const url = (size: number) =>
    `${publicUrl}/media/placeholder/${hue}/${size}/${encodeURIComponent(label)}.svg`;
  return {
    id,
    alt,
    isPrimary: false,
    url: url(1600),
    sizes: {
      small: { url: url(320), width: 320, height: 320 },
      medium: { url: url(800), width: 800, height: 800 },
      large: { url: url(1600), width: 1600, height: 1600 },
    },
    bytes: 120_000 + hue * 300,
    uploadedAt,
  };
}

// name en, name de, [children: en, de]
const CATEGORY_TREE: [string, string, [string, string][]][] = [
  [
    "Rice & Grains",
    "Reis & Getreide",
    [
      ["Basmati Rice", "Basmati Reis"],
      ["Everyday Rice", "Reis für jeden Tag"],
    ],
  ],
  [
    "Flour",
    "Mehl",
    [
      ["Atta", "Atta"],
      ["Gram & Rice Flour", "Kichererbsen- & Reismehl"],
    ],
  ],
  ["Pulses", "Hülsenfrüchte", []],
  [
    "Spices",
    "Gewürze",
    [
      ["Whole Spices", "Ganze Gewürze"],
      ["Ground Spices", "Gemahlene Gewürze"],
    ],
  ],
  [
    "Snacks & Sweets",
    "Snacks & Süßes",
    [
      ["Namkeen", "Namkeen"],
      ["Sweets", "Süßigkeiten"],
    ],
  ],
  ["Fresh Fruit", "Frisches Obst", [["Mangoes", "Mangos"]]],
  ["Tea & Beverages", "Tee & Getränke", []],
  [
    "Pantry",
    "Vorrat",
    [
      ["Ghee & Oil", "Ghee & Öl"],
      ["Pickles & Papad", "Pickles & Papad"],
    ],
  ],
  ["Frozen", "Tiefkühlware", []],
];

interface ProductSeed {
  name: [string, string];
  brand: string | null;
  category: string;
  /** value, unit, regular price, sale price */
  packs: [number, PackUnit, number, number?][];
  hue: number;
  storage?: StorageType;
  status?: "draft" | "active" | "archived";
  available?: boolean;
  origin?: string;
  ingredients?: [string, string];
}

const PRODUCTS: ProductSeed[] = [
  {
    name: ["Basmati Rice", "Basmati Reis"],
    brand: "India Gate",
    category: "Basmati Rice",
    packs: [
      [1, "kg", 499],
      [5, "kg", 2499, 1999],
      [10, "kg", 4599],
    ],
    hue: 42,
    origin: "India",
    ingredients: ["Basmati rice", "Basmatireis"],
  },
  {
    name: ["Sona Masoori Rice", "Sona Masoori Reis"],
    brand: "Daawat",
    category: "Everyday Rice",
    packs: [
      [5, "kg", 1499],
      [10, "kg", 2799],
    ],
    hue: 48,
    origin: "India",
  },
  {
    name: ["Poha Thick", "Poha dick"],
    brand: "TRS",
    category: "Everyday Rice",
    packs: [[500, "g", 249]],
    hue: 55,
    origin: "India",
  },
  {
    name: ["Chakki Atta", "Chakki Atta"],
    brand: "Aashirvaad",
    category: "Atta",
    packs: [
      [5, "kg", 1299],
      [10, "kg", 2399, 2199],
    ],
    hue: 30,
    origin: "India",
    ingredients: ["Whole wheat flour", "Weizenvollkornmehl"],
  },
  {
    name: ["Besan Gram Flour", "Besan Kichererbsenmehl"],
    brand: "TRS",
    category: "Gram & Rice Flour",
    packs: [[1, "kg", 399]],
    hue: 50,
  },
  {
    name: ["Rice Flour", "Reismehl"],
    brand: "TRS",
    category: "Gram & Rice Flour",
    packs: [[1, "kg", 279]],
    hue: 60,
  },
  {
    name: ["Toor Dal", "Toor Dal"],
    brand: "TRS",
    category: "Pulses",
    packs: [
      [1, "kg", 449],
      [2, "kg", 849],
    ],
    hue: 38,
  },
  {
    name: ["Moong Dal", "Moong Dal"],
    brand: "TRS",
    category: "Pulses",
    packs: [[1, "kg", 479]],
    hue: 75,
  },
  {
    name: ["Chana Dal", "Chana Dal"],
    brand: "Heera",
    category: "Pulses",
    packs: [[1, "kg", 399]],
    hue: 45,
  },
  {
    name: ["Masoor Dal", "Masoor Dal"],
    brand: "Heera",
    category: "Pulses",
    packs: [[1, "kg", 379]],
    hue: 18,
  },
  {
    name: ["Cumin Seeds", "Kreuzkümmel ganz"],
    brand: "MDH",
    category: "Whole Spices",
    packs: [[200, "g", 349]],
    hue: 28,
  },
  {
    name: ["Turmeric Powder", "Kurkuma gemahlen"],
    brand: "MDH",
    category: "Ground Spices",
    packs: [[200, "g", 249]],
    hue: 40,
  },
  {
    name: ["Garam Masala", "Garam Masala"],
    brand: "MDH",
    category: "Ground Spices",
    packs: [[100, "g", 299]],
    hue: 20,
  },
  {
    name: ["Kashmiri Chilli Powder", "Kashmiri Chilipulver"],
    brand: "Everest",
    category: "Ground Spices",
    packs: [[200, "g", 379, 329]],
    hue: 8,
  },
  {
    name: ["Banana Chips", "Bananenchips"],
    brand: "A-1",
    category: "Namkeen",
    packs: [[200, "g", 399]],
    hue: 52,
  },
  {
    name: ["Bhujia Sev", "Bhujia Sev"],
    brand: "Haldiram's",
    category: "Namkeen",
    packs: [[400, "g", 449]],
    hue: 35,
  },
  {
    name: ["Methi Khakhra", "Methi Khakhra"],
    brand: "Induben",
    category: "Namkeen",
    packs: [[200, "g", 329]],
    hue: 95,
  },
  {
    name: ["Soan Papdi", "Soan Papdi"],
    brand: "Haldiram's",
    category: "Sweets",
    packs: [[250, "g", 399]],
    hue: 46,
  },
  {
    name: ["Kesar Mango Box", "Kesar Mango Kiste"],
    brand: null,
    category: "Mangoes",
    packs: [[3, "kg", 2499]],
    hue: 36,
    storage: "chilled",
    origin: "Gujarat, India",
  },
  {
    name: ["Alphonso Mango Box", "Alphonso Mango Kiste"],
    brand: null,
    category: "Mangoes",
    packs: [[3, "kg", 3299]],
    hue: 32,
    storage: "chilled",
    origin: "Maharashtra, India",
    available: false,
  },
  {
    name: ["Premium Leaf Tea", "Premium Blatt-Tee"],
    brand: "Wagh Bakri",
    category: "Tea & Beverages",
    packs: [
      [250, "g", 399],
      [500, "g", 749],
      [1, "kg", 1399, 1249],
    ],
    hue: 12,
  },
  {
    name: ["Masala Chai", "Masala Chai"],
    brand: "Wagh Bakri",
    category: "Tea & Beverages",
    packs: [[250, "g", 449]],
    hue: 22,
  },
  {
    name: ["Pure Cow Ghee", "Reines Kuh-Ghee"],
    brand: "Amul",
    category: "Ghee & Oil",
    packs: [
      [500, "ml", 899],
      [1, "l", 1699],
    ],
    hue: 49,
  },
  {
    name: ["Mango Pickle", "Mango Pickle"],
    brand: "Mother's Recipe",
    category: "Pickles & Papad",
    packs: [[400, "g", 349]],
    hue: 15,
  },
  {
    name: ["Urad Papad", "Urad Papad"],
    brand: "Lijjat",
    category: "Pickles & Papad",
    packs: [[200, "g", 229]],
    hue: 44,
  },
  {
    name: ["Paneer", "Paneer"],
    brand: "Amul",
    category: "Frozen",
    packs: [[400, "g", 549]],
    hue: 200,
    storage: "frozen",
    status: "draft",
  },
  {
    name: ["Jaggery Powder", "Jaggery Pulver"],
    brand: "24 Mantra",
    category: "Pantry",
    packs: [[500, "g", 399]],
    hue: 26,
    status: "archived",
  },
];

const FIRST = [
  "Priya",
  "Anna",
  "Jonas",
  "Meera",
  "Lukas",
  "Sara",
  "Rahul",
  "Lena",
  "Amit",
  "Sophie",
  "Neha",
  "Felix",
  "Kiran",
  "Marie",
  "Vikram",
  "Laura",
  "Anjali",
  "Paul",
  "Deepa",
  "Tim",
  "Pooja",
  "Leon",
  "Ritu",
  "Emma",
  "Sanjay",
  "Mia",
  "Divya",
  "Noah",
  "Kavita",
  "Elias",
  "Arjun",
  "Hannah",
];
const LAST = [
  "Shah",
  "Schmidt",
  "Weber",
  "Patel",
  "Becker",
  "Yilmaz",
  "Mehta",
  "Fischer",
  "Desai",
  "Wagner",
  "Joshi",
  "Hoffmann",
  "Trivedi",
  "Schulz",
  "Rao",
  "Koch",
  "Iyer",
  "Richter",
  "Nair",
  "Klein",
  "Vasoya",
  "Wolf",
  "Kapoor",
  "Neumann",
  "Bhatt",
  "Braun",
  "Reddy",
  "Krüger",
  "Parmar",
  "Hartmann",
];
const PLACES: [string, string][] = [
  ["60311", "Frankfurt am Main"],
  ["60486", "Frankfurt am Main"],
  ["60594", "Frankfurt am Main"],
  ["65929", "Frankfurt am Main"],
  ["63065", "Offenbach am Main"],
  ["63067", "Offenbach am Main"],
  ["61348", "Bad Homburg"],
  ["65185", "Wiesbaden"],
  ["55116", "Mainz"],
  ["64283", "Darmstadt"],
  ["65760", "Eschborn"],
  ["61118", "Bad Vilbel"],
  ["63450", "Hanau"],
  ["65824", "Schwalbach am Taunus"],
];
const STREETS = [
  "Hauptstraße",
  "Bahnhofstraße",
  "Gartenstraße",
  "Schillerstraße",
  "Goethestraße",
  "Berliner Straße",
  "Mainzer Landstraße",
  "Kaiserstraße",
  "Lindenweg",
  "Am Römerhof",
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const LEGAL_EN = (title: string, version: number) =>
  `# ${title}\n\nVersion ${version}. These terms apply to every order placed at Radhe Foods.\n\n## 1. Order and price\n\nYou order at the price shown at checkout, VAT included. **The order is confirmed once your payment is captured.**\n\n## 2. Payment\n\nYou pay at checkout by card or PayPal. The invoice is issued the moment the payment is captured and sent with the confirmation${version > 1 ? ", as a PDF" : ""}.\n\n## 3. Delivery\n\nWe deliver anywhere in Germany. The delivery estimate is shown at checkout.\n\n## 4. Returns\n\nYou can ask to return single products within 14 days of delivery.\n`;
const LEGAL_DE = (title: string, version: number) =>
  `# ${title}\n\nVersion ${version}. Diese Bedingungen gelten für jede Bestellung bei Radhe Foods.\n\n## 1. Bestellung und Preis\n\nSie bestellen zum an der Kasse angezeigten Preis inklusive Mehrwertsteuer. **Die Bestellung ist bestätigt, sobald Ihre Zahlung eingezogen ist.**\n\n## 2. Zahlung\n\nSie zahlen an der Kasse per Karte oder PayPal. Die Rechnung wird mit dem Zahlungseingang ausgestellt und mit der Bestätigung versandt${version > 1 ? ", als PDF" : ""}.\n\n## 3. Lieferung\n\nWir liefern deutschlandweit. Die voraussichtliche Lieferzeit wird an der Kasse angezeigt.\n\n## 4. Rücksendungen\n\nEinzelne Produkte können Sie innerhalb von 14 Tagen nach Lieferung zurückgeben.\n`;

export interface SeedOptions extends MockConfig {
  now?: number;
}

export function seed(options: SeedOptions): Db {
  const now = options.now ?? Date.now();
  const rng = random(20260927);
  const db = emptyDb({
    stripe: options.stripe,
    whatsapp: options.whatsapp,
    publicUrl: options.publicUrl,
  });
  const long = now - 120 * DAY;
  void berlinDay;

  // --- Roles and admins -----------------------------------------------------
  const role = (
    key: string,
    name: string,
    description: string | null,
    permissions: string[],
    isSystem = false,
  ): Role => ({
    id: newId(long),
    key,
    name,
    description,
    permissions,
    isSystem,
    createdAt: iso(long),
    updatedAt: iso(long),
  });
  const superAdmin = role(
    "super_admin",
    "Super Admin",
    "Everything, including roles. Cannot be edited.",
    ["*"],
    true,
  );
  const orderManager = role(
    "order_manager",
    "Order manager",
    "Handles orders and returns; reads the rest.",
    [
      "orders.read",
      "orders.manage",
      "payments.read",
      "customers.read",
      "catalog.read",
      "notifications.read",
      "quotations.read",
      "quotations.manage",
    ],
  );
  const catalogueEditor = role(
    "catalogue_editor",
    "Catalogue editor",
    "Keeps products, categories, pictures and discount codes, retail and wholesale.",
    [
      "catalog.read",
      "catalog.manage",
      "wholesale.read",
      "wholesale.manage",
      "discounts.read",
      "discounts.manage",
    ],
  );
  const viewer = role(
    "viewer",
    "Viewer",
    "Reads everything, changes nothing.",
    ALL_PERMISSIONS.filter((p) => p.endsWith(".read")),
  );
  db.roles.push(superAdmin, orderManager, catalogueEditor, viewer);

  const admin = (
    key: keyof typeof DEMO_ADMINS,
    name: string,
    roleId: string,
    extra: Partial<AdminRecord> = {},
  ): AdminRecord => ({
    id: newId(long + db.admins.length * 1000),
    email: DEMO_ADMINS[key].email,
    name,
    status: "active",
    roleId,
    password: DEMO_ADMINS[key].password,
    totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    pendingTotpSecret: null,
    lastTotpStep: null,
    mustChangePassword: false,
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: iso(now - 20 * HOUR),
    createdAt: iso(long),
    updatedAt: iso(long),
    ...extra,
  });
  const owner = admin("owner", "Vrushabh Vasoya", superAdmin.id);
  db.admins.push(
    owner,
    admin("orders", "Nisha Patel", orderManager.id, {
      lastLoginAt: iso(now - 3 * DAY),
    }),
    admin("viewer", "Tobias Keller", viewer.id, {
      lastLoginAt: iso(now - 9 * DAY),
    }),
    admin("newcomer", "Riya Sharma", catalogueEditor.id, {
      totpSecret: null,
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: iso(now - DAY),
      updatedAt: iso(now - DAY),
    }),
    admin("disabled", "Jan Former", orderManager.id, {
      status: "disabled",
      lastLoginAt: iso(now - 60 * DAY),
    }),
  );

  // --- Settings and legal texts ---------------------------------------------
  db.settings.deliveryFee.tiers = [
    { minOrderValue: 0, fee: 499 },
    { minOrderValue: 5000, fee: 0 },
  ];
  db.settings.company = {
    name: "Radhe Foods",
    addressLines: ["Hanauer Landstraße 120", "60314 Frankfurt am Main"],
    email: "billing@radhefoods.de",
    phone: "+49 69 1234567",
    website: "https://www.radhefoods.de",
    vatId: "DE123456789",
    invoiceFooter: "Thank you for shopping with Radhe Foods.",
    missingForInvoices: [],
  };
  const legal = (
    type: "terms" | "privacy",
    version: number,
    published: number | null,
    en: string,
    de: string,
    note: string | null,
  ) => {
    const created = (published ?? now) - DAY;
    db.legal.push({
      id: newId(created),
      type,
      version,
      status: published ? "published" : "draft",
      title: { en, de },
      content: { en: LEGAL_EN(en, version), de: LEGAL_DE(de, version) },
      note,
      publishedAt: published ? iso(published) : null,
      createdAt: iso(created),
      updatedAt: iso(published ?? now - 2 * HOUR),
    });
  };
  legal(
    "terms",
    1,
    now - 110 * DAY,
    "Terms and Conditions",
    "Allgemeine Geschäftsbedingungen",
    "First version",
  );
  legal(
    "terms",
    2,
    now - 40 * DAY,
    "Terms and Conditions",
    "Allgemeine Geschäftsbedingungen",
    "Checkout and payment wording",
  );
  legal(
    "terms",
    3,
    null,
    "Terms and Conditions",
    "Allgemeine Geschäftsbedingungen",
    "Return window wording",
  );
  legal(
    "privacy",
    1,
    now - 110 * DAY,
    "Privacy Policy",
    "Datenschutzerklärung",
    null,
  );

  // --- Categories and products ----------------------------------------------
  const categoryByName = new Map<string, CategoryRecord>();
  const addCategory = (
    en: string,
    de: string,
    parentId: string | null,
    sortOrder: number,
    hue: number,
  ): CategoryRecord => {
    const at = long + categoryByName.size * 60_000;
    const record: CategoryRecord = {
      id: newId(at),
      name: { en, de },
      slug: { en: slugify(en), de: slugify(de) },
      tagline: parentId
        ? null
        : { en: `Everything ${en.toLowerCase()}`, de: null },
      description: null,
      parentId,
      sortOrder,
      isVisible: en !== "Frozen",
      // The second main category groups the sizes of a product; the rest shows rounds.
      listingView:
        en === "Pulses"
          ? "variants_by_product"
          : en === "Flour"
            ? "product"
            : "variants_by_size",
      image: parentId
        ? null
        : {
            ...placeholderImage(
              options.publicUrl,
              newId(at),
              en,
              hue,
              iso(at),
              { en, de },
            ),
            isPrimary: true,
          },
      seo: null,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    db.categories.push(record);
    categoryByName.set(en, record);
    return record;
  };
  CATEGORY_TREE.forEach(([en, de, children], index) => {
    const parent = addCategory(en, de, null, index, 20 + index * 37);
    children.forEach(([childEn, childDe], childIndex) =>
      addCategory(childEn, childDe, parent.id, childIndex, 0),
    );
  });

  for (const item of PRODUCTS) {
    const category = categoryByName.get(item.category);
    if (!category) continue;
    // One product with its pack sizes (8): the texts and pictures are the
    // product's, each pack size has its own article number, price and stock.
    db.counters.sku += 1;
    const at = long + db.counters.sku * 3600_000;
    const status = item.status ?? "active";
    const id = newId(at);
    const images = Array.from({ length: 2 }, (_, imageIndex) => ({
      ...placeholderImage(
        options.publicUrl,
        newId(at + imageIndex + 1),
        item.name[0],
        item.hue + imageIndex * 14,
        iso(at),
        { en: item.name[0], de: imageIndex === 0 ? item.name[1] : null },
      ),
      isPrimary: imageIndex === 0,
    }));
    const product: ProductRecord = {
      id,
      name: { en: item.name[0], de: item.name[1] },
      slug: { en: slugify(item.name[0]), de: slugify(item.name[1]) },
      brand: item.brand,
      vatRate: 700,
      status,
      isAvailable: item.available ?? true,
      isFeatured: rng.chance(0.15),
      sortOrder: 0,
      subtitle: null,
      shortDescription: {
        en: `${item.name[0]} in ${item.packs.length > 1 ? "several pack sizes" : "one pack size"}.`,
        de: `${item.name[1]} in ${item.packs.length > 1 ? "mehreren Packungsgrößen" : "einer Packungsgröße"}.`,
      },
      description: {
        en: `${item.name[0]}${item.brand ? ` by ${item.brand}` : ""}. A staple of the Indian kitchen, in stock and delivered anywhere in Germany.`,
        de: rng.chance(0.75)
          ? `${item.name[1]}${item.brand ? ` von ${item.brand}` : ""}. Ein Grundnahrungsmittel der indischen Küche.`
          : null,
      },
      highlights: {
        en: ["Authentic quality", "Imported from India"],
        de: ["Authentische Qualität"],
      },
      uses: { en: [], de: [] },
      categoryId: category.id,
      minOrderQuantity: 1,
      maxOrderQuantity: item.storage === "chilled" ? 4 : null,
      storageType: item.storage ?? "ambient",
      variants: [],
      food: {
        ingredients: item.ingredients
          ? { en: item.ingredients[0], de: item.ingredients[1] }
          : null,
        allergens: null,
        nutrition: null,
        storageInstructions: {
          en: "Store cool and dry.",
          de: "Kühl und trocken lagern.",
        },
        origin: item.origin ?? "India",
        manufacturer: null,
      },
      tags: item.packs.some((pack) => pack[3]) ? ["offer"] : [],
      searchKeywords: [item.name[1]],
      seo: null,
      images,
      publishedAt: status === "draft" ? null : iso(at + HOUR),
      createdAt: iso(at),
      updatedAt: iso(at + HOUR),
    };
    db.products.push(product);
    item.packs.forEach(([value, unit, regularPrice, salePrice], index) => {
      if (index > 0) db.counters.sku += 1;
      const sku = `RF-${String(db.counters.sku).padStart(5, "0")}`;
      const variant: VariantRecord = {
        id: newId(at + index + 10),
        sku,
        gtin: rng.chance(0.6)
          ? `890${String(1000000000 + db.counters.sku * 7919).slice(0, 10)}`
          : null,
        packSize: { value, unit, label: packLabel(value, unit) },
        regularPrice,
        salePrice: salePrice ?? null,
        isEnabled: true,
        stock: {
          quantity: 0,
          // The first pack size of a product with several has a threshold;
          // a product with one pack size every other time.
          lowStockThreshold:
            index === 0
              ? item.packs.length > 1 || db.counters.sku % 2 === 0
                ? 12
                : null
              : rng.chance(0.5)
                ? 8
                : null,
        },
        createdAt: iso(at),
      };
      product.variants.push(variant);
      // The opening stock, counted when the pack size was created.
      if (status !== "draft") {
        recordMovement(
          db,
          product,
          variant,
          "restock",
          rng.int(40, 160),
          { adminId: owner.id, note: "Opening stock" },
          at + 10 * 60_000,
        );
      }
      const history = [
        {
          regularPrice,
          salePrice: null as number | null,
          price: regularPrice,
          vatRate: 700,
          changedBy: owner.id,
          changedAt: iso(at),
        },
      ];
      if (salePrice)
        history.unshift({
          regularPrice,
          salePrice,
          price: salePrice,
          vatRate: 700,
          changedBy: owner.id,
          changedAt: iso(now - 12 * DAY),
        });
      db.priceChanges.set(variant.id, history);
    });
  }
  // One pack size is not offered at the moment: the product stays on sale.
  const withSizes = db.products.find(
    (product) => product.status === "active" && product.variants.length > 2,
  );
  const disabled = withSizes?.variants[withSizes.variants.length - 1];
  if (disabled) disabled.isEnabled = false;
  const orderable = db.products.filter(
    (product) => product.status === "active" && product.isAvailable,
  );

  // --- Customers ------------------------------------------------------------
  for (let index = 0; index < 68; index += 1) {
    const firstName = FIRST[index % FIRST.length] as string;
    const lastName = LAST[(index * 7 + 3) % LAST.length] as string;
    const [postalCode, city] = rng.pick(PLACES);
    const created = now - (110 - index) * DAY - rng.int(0, 20) * HOUR;
    const phone = `+49151${String(10000000 + index * 104729).slice(0, 8)}`;
    const whatsapp = rng.chance(0.4);
    const marketing = rng.chance(0.55);
    const email = `${slugify(firstName)}.${slugify(lastName)}${index > 29 ? index : ""}@example.com`;
    db.customers.push({
      id: newId(created),
      email,
      firstName,
      lastName,
      phone: rng.chance(0.8) ? phone : null,
      locale: rng.chance(0.55) ? "de" : "en",
      hasGoogleLogin: rng.chance(0.3),
      communication: {
        whatsappNumber: whatsapp ? phone : null,
        whatsappOptIn: whatsapp,
        whatsappOptInAt: whatsapp ? iso(created + DAY) : null,
        marketingOptIn: marketing,
        marketingOptInAt: marketing ? iso(created + DAY) : null,
        marketingOptOutAt: null,
      },
      createdAt: iso(created),
      status: "active",
      blockedReason: null,
      blockedAt: null,
      signupMethod: rng.chance(0.3) ? "google" : "email_otp",
      emailVerifiedAt: iso(created),
      lastLoginAt: iso(now - rng.int(1, 30) * DAY),
      updatedAt: iso(created + DAY),
      addresses: [
        {
          id: newId(created + 1000),
          firstName,
          lastName,
          company: null,
          street: rng.pick(STREETS),
          houseNumber: `${rng.int(1, 140)}${rng.chance(0.15) ? "a" : ""}`,
          additionalLine: rng.chance(0.12) ? "2. OG" : null,
          postalCode,
          city,
          countryCode: "DE",
          phone: null,
          isDefault: true,
        },
      ],
    });
  }
  const blocked = db.customers[7] as Customer;
  blocked.status = "blocked";
  blocked.blockedReason = "Three orders refused at the door.";
  blocked.blockedAt = iso(now - 30 * DAY);

  // --- Orders ---------------------------------------------------------------
  // Every order starts at checkout as pending; the payment confirms it
  // (architecture 7.1, 7.2). The seed walks each one through the same steps
  // the routes take, so the ledger, the invoices and the messages are real.
  db.counters.order = 1000;
  const buyers = db.customers.filter(
    (customer) => customer.status === "active",
  );
  /** The pack sizes that can be bought now, with their product. */
  // The discount codes exist before the orders: some orders are made with one (26).
  const codes = seedDiscountCodes(db, now, owner);

  const sellable = () =>
    orderable.flatMap((product) =>
      product.variants
        .filter((variant) => variant.isEnabled && variant.stock.quantity >= 6)
        .map((variant) => ({ product, variant })),
    );

  const placeOrder = (
    customer: Customer,
    placedAt: number,
    method?: DeliveryMethod,
    wanted?: DiscountCodeRecord,
  ): OrderRecord => {
    db.counters.order += 1;
    const lines = rng.int(1, 4);
    const chosen = new Set<{
      product: ProductRecord;
      variant: VariantRecord;
    }>();
    const inStock = sellable();
    while (chosen.size < lines) chosen.add(rng.pick(inStock));
    const items = [...chosen].map(({ product, variant }) => {
      const quantity =
        product.storageType === "chilled" ? rng.int(1, 2) : rng.int(1, 3);
      const unitPrice = variant.salePrice ?? variant.regularPrice;
      return {
        productId: product.id,
        variantId: variant.id,
        sku: variant.sku,
        name: product.name,
        displayName: `${product.name.en} (${variant.packSize.label})`,
        packSize: variant.packSize,
        imageUrl: product.images[0]?.sizes.small.url ?? null,
        quantity,
        unitPrice,
        regularUnitPrice:
          variant.salePrice === null ? null : variant.regularPrice,
        lineTotal: quantity * unitPrice,
        vatRate: product.vatRate,
        vatPercent: product.vatRate / 100,
        vatAmount: vatOf(quantity * unitPrice, product.vatRate),
        discountAmount: 0,
        deliveredQuantity: quantity,
        returnedQuantity: 0,
        finalLineTotal: quantity * unitPrice,
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    // The code applies when the goods reach its minimum and the customer
    // has not used a once-per-customer code already; else the order is made without it.
    const code =
      wanted &&
      subtotal >= (wanted.minOrderValue ?? 0) &&
      !(
        wanted.oncePerCustomer &&
        db.discountUses.some(
          (use) =>
            use.codeId === wanted.id &&
            use.customerId === customer.id &&
            use.counts,
        )
      )
        ? wanted
        : undefined;
    const shares = code ? discountShares(items, code) : null;
    items.forEach((item, index) => {
      item.discountAmount = shares?.shares[index] ?? 0;
      item.lineTotal -= item.discountAmount;
      item.finalLineTotal = item.lineTotal;
      item.vatAmount = vatOf(item.lineTotal, item.vatRate);
    });
    const discount = shares?.amount ?? 0;
    const totals = totalsOf(
      items.map((item) => ({ gross: item.lineTotal, vatRate: item.vatRate })),
      deliveryFeeFor(db, subtotal - discount),
      discount,
    );
    const address = customer.addresses[0];
    const pageMinutes = db.settings.payments.checkoutMinutes;
    const expiresAt = placedAt + pageMinutes * 60_000;
    const number = db.counters.order;
    const order: OrderRecord = {
      id: newId(placedAt),
      orderNumber: `RF-${number}`,
      status: "pending_payment",
      paymentStatus: "pending",
      placedAt: iso(placedAt),
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName ?? undefined,
        lastName: customer.lastName ?? undefined,
        ...(customer.phone ? { phone: customer.phone } : {}),
      },
      currency: "EUR",
      delivery: {
        method: method ?? db.settings.delivery.defaultMethod,
        trackingNumber: null,
        trackingUrl: null,
        dispatchedAt: null,
        deliveredAt: null,
      },
      language: customer.locale,
      items,
      totals,
      finalTotals: totals,
      discount: null,
      adjustments: [],
      deliveryAddress: {
        firstName: address?.firstName ?? "",
        lastName: address?.lastName ?? "",
        street: address?.street ?? "",
        houseNumber: address?.houseNumber ?? "",
        ...(address?.additionalLine
          ? { additionalLine: address.additionalLine }
          : {}),
        postalCode: address?.postalCode ?? "",
        city: address?.city ?? "",
        countryCode: "DE",
        ...(customer.phone ? { phone: customer.phone } : {}),
      },
      note: rng.chance(0.12)
        ? rng.pick([
            "Please ring twice.",
            "Leave with the neighbour if I am out.",
            "Bitte nach 17 Uhr liefern.",
          ])
        : null,
      payment: {
        amount: totals.total,
        paidAmount: 0,
        creditedAmount: 0,
        refundedAmount: 0,
        attempts: 1,
        checkoutSessionId: `cs_test_demo${number}`,
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_test_demo${number}`,
        checkoutExpiresAt: iso(expiresAt),
        paymentIntentId: null,
        chargeId: null,
        paymentType: null,
        receiptUrl: null,
        authorizedAt: null,
        paidAt: null,
        invoiceId: null,
        invoiceNumber: null,
        lastFailure: null,
      },
      pendingUntil: iso(expiresAt + 10 * 60_000),
      stockTakenAt: null,
      cancellation: null,
      consent: {
        acceptedAt: iso(placedAt),
        documents: [
          {
            type: "terms",
            version: placedAt > now - 40 * DAY ? 2 : 1,
            documentId: (db.legal.find(
              (doc) =>
                doc.type === "terms" &&
                doc.version === (placedAt > now - 40 * DAY ? 2 : 1),
            ) ?? db.legal[0])!.id,
          },
          {
            type: "privacy",
            version: 1,
            documentId: db.legal.find((doc) => doc.type === "privacy")!.id,
          },
        ],
        ip: `203.0.113.${rng.int(2, 250)}`,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
      },
      statusHistory: [
        {
          field: "order",
          from: null,
          to: "pending_payment",
          at: iso(placedAt),
          by: "customer",
          adminId: null,
          note: null,
        },
      ],
      updatedAt: iso(placedAt),
    };
    db.orders.push(order);
    if (code && discount > 0) {
      reserveDiscountUse(db, order, code, discount, placedAt);
    }
    return order;
  };

  /** The customer paid on the Stripe page a few minutes after checkout. */
  const pay = (order: OrderRecord, at: number): void => {
    const number = order.orderNumber.slice(3);
    settleOrder(
      db,
      order,
      {
        paymentType: rng.chance(0.7) ? "card" : "paypal",
        paymentIntentId: `pi_3Demo${number}`,
        chargeId: `ch_3Demo${number}`,
        receiptUrl: "https://pay.stripe.com/receipts/demo",
      },
      at,
    );
  };

  const tracking = (order: OrderRecord) => {
    if (order.delivery.method === "dhl")
      order.delivery.trackingNumber = `0034043416109${4000000 + db.counters.order}`;
    if (order.delivery.method === "hermes")
      order.delivery.trackingNumber = `H100${4800000 + db.counters.order}`;
  };
  const actor = { adminId: owner.id };
  const pickMethod = () =>
    rng.pick<DeliveryMethod>([
      "radhe_delivery",
      "radhe_delivery",
      "dhl",
      "dhl",
      "hermes",
    ]);

  type Plan =
    | "delivered"
    | "dispatched"
    | "processing"
    | "confirmed"
    | "pending"
    | "failed"
    | "cancelled_by_customer"
    | "given_up"
    | "cancelled_by_admin";

  const walk = (
    plan: Plan,
    placedAt: number,
    code?: DiscountCodeRecord,
  ): OrderRecord => {
    const order = placeOrder(rng.pick(buyers), placedAt, pickMethod(), code);
    const paidAt = placedAt + rng.int(4, 12) * 60_000;
    if (plan === "pending") return order;
    if (plan === "failed") {
      failPayment(db, order, "Your card was declined.", paidAt);
      order.payment.attempts = 2;
      return order;
    }
    if (plan === "given_up") {
      cancelOrder(
        db,
        order,
        {
          reason: "payment_not_completed",
          text: null,
          by: "system",
          adminId: null,
        },
        placedAt + 70 * 60_000,
        { email: false },
      );
      return order;
    }
    pay(order, paidAt);
    if (plan === "confirmed") return order;
    if (plan === "cancelled_by_customer") {
      cancelOrder(
        db,
        order,
        { reason: "changed_mind", text: null, by: "customer", adminId: null },
        paidAt + rng.int(2, 20) * HOUR,
      );
      return order;
    }
    if (plan === "cancelled_by_admin") {
      cancelOrder(
        db,
        order,
        {
          reason: "duplicate_order",
          text: "The same order was placed twice within a minute.",
          by: "admin",
          adminId: owner.id,
        },
        paidAt + 3 * HOUR,
      );
      return order;
    }
    const processingAt = Math.min(now - HOUR, paidAt + rng.int(2, 20) * HOUR);
    setOrderStatus(db, order, "processing", actor, processingAt);
    if (plan === "processing") return order;
    tracking(order);
    const dispatchedAt = Math.min(
      now - HOUR,
      processingAt + rng.int(4, 26) * HOUR,
    );
    setOrderStatus(db, order, "dispatched", actor, dispatchedAt);
    if (plan === "dispatched") return order;
    const deliveredAt = Math.min(
      now - HOUR,
      dispatchedAt + rng.int(20, 50) * HOUR,
    );
    setOrderStatus(db, order, "delivered", actor, deliveredAt);
    return order;
  };

  // Which delivered orders were made with a discount code: the spring code
  // while it ran, the early-bird code until it was used up, the others since.
  const codeOf: Record<number, DiscountCodeRecord> = {
    2: codes.spring,
    5: codes.spring,
    8: codes.earlyBird,
    11: codes.earlyBird,
    14: codes.earlyBird,
    16: codes.welcome,
    20: codes.welcome,
    22: codes.diwali,
  };
  const delivered: OrderRecord[] = [];
  for (let index = 0; index < 24; index += 1) {
    delivered.push(
      walk(
        "delivered",
        now - (50 - index * 1.7) * DAY - rng.int(1, 9) * HOUR,
        codeOf[index],
      ),
    );
  }
  const givenUp = walk("given_up", now - 9 * DAY - 5 * HOUR, codes.diwali);
  const refundedByAdmin = walk("cancelled_by_admin", now - 10 * DAY - 2 * HOUR);
  for (let index = 0; index < 4; index += 1) {
    walk(
      "dispatched",
      now - (5 - index * 0.5) * DAY - rng.int(1, 6) * HOUR,
      index === 1 ? codes.diwali : undefined,
    );
  }
  for (let index = 0; index < 3; index += 1) {
    walk(
      "processing",
      now - (2.5 - index * 0.5) * DAY - rng.int(1, 4) * HOUR,
      index === 0 ? codes.welcome : undefined,
    );
  }
  const cancelledPaid = walk("cancelled_by_customer", now - 2 * DAY - 3 * HOUR);
  const toProcess: OrderRecord[] = [];
  for (let index = 0; index < 5; index += 1) {
    toProcess.push(
      walk(
        "confirmed",
        now - (40 - index * 7) * HOUR - rng.int(5, 50) * 60_000,
        index === 2 ? codes.diwali : undefined,
      ),
    );
  }
  walk("failed", now - 3 * HOUR);
  const pending = walk("pending", now - 20 * 60_000, codes.diwali);
  void givenUp;
  void pending;

  // The admin cancelled a duplicate and refunded it by hand: nothing waits there.
  {
    const at = now - 9 * DAY;
    const refund: Refund = {
      id: newId(at),
      refundNumber: `${refundedByAdmin.orderNumber}-RF1`,
      orderId: refundedByAdmin.id,
      orderNumber: refundedByAdmin.orderNumber,
      customerId: refundedByAdmin.customer.id,
      invoiceNumber: refundedByAdmin.payment.invoiceNumber,
      amount: refundedByAdmin.payment.paidAmount,
      reason: "duplicate_payment",
      method: "manual",
      status: "pending",
      manual: {
        way: "bank_transfer",
        reference: "SEPA 2026-10-0391",
        paidAt: null,
      },
      stripe: null,
      note: null,
      createdBy: owner.id,
      createdAt: iso(at),
      completedAt: null,
      statusHistory: [
        {
          from: null,
          to: "pending",
          at: iso(at),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
      ],
    };
    db.refunds.push(refund);
    refund.manual!.paidAt = iso(at + DAY);
    completeRefund(db, refund, "admin", owner.id, null, at + DAY);
  }
  void cancelledPaid;

  // --- A correction, returns and refunds ------------------------------------
  const withSeveral = delivered.filter((order) =>
    order.items.some((item) => item.quantity > 1),
  );

  // A crushed box, found after delivery: credit note, refund to decide.
  const corrected = withSeveral[withSeveral.length - 1];
  if (corrected) {
    const item = corrected.items.find((entry) => entry.quantity > 1)!;
    const at = now - 4 * DAY + 3 * HOUR;
    corrected.adjustments.push({
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      from: item.quantity,
      to: item.quantity - 1,
      reason: "damaged",
      note: "Box crushed in transit.",
      adminId: owner.id,
      at: iso(at),
    });
    item.deliveredQuantity -= 1;
    recomputeFinal(corrected);
    releaseUnits(db, corrected, item.variantId, 1, at);
    issueCreditNote(
      db,
      corrected,
      item.unitPrice,
      "adjustment",
      at,
      `${item.sku}: damaged`,
    );
  }

  // A completed return with its refund sent: nothing waits there.
  const returned = withSeveral[0];
  if (returned) {
    const item = returned.items[0]!;
    const customer = db.customers.find(
      (entry) => entry.id === returned.customer.id,
    )!;
    const requested = now - 18 * DAY + 14 * HOUR;
    const completed = requested + 4 * DAY;
    item.returnedQuantity = 1;
    recomputeFinal(returned);
    issueCreditNote(
      db,
      returned,
      item.unitPrice,
      "return",
      completed,
      `${returned.orderNumber}-R1`,
    );
    db.returns.push({
      id: newId(requested),
      returnNumber: `${returned.orderNumber}-R1`,
      orderId: returned.id,
      orderNumber: returned.orderNumber,
      customerId: returned.customer.id,
      status: "completed",
      requestedAt: iso(requested),
      decidedAt: iso(requested + DAY),
      completedAt: iso(completed),
      items: [
        {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku,
          name: item.name,
          packSize: item.packSize,
          quantity: 1,
          approvedQuantity: 1,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          reason: "quality",
          comment: "Tasted stale.",
        },
      ],
      requestedAmount: item.unitPrice,
      customerComment: null,
      decisionNote: "Send it back with the enclosed label.",
      internalNote: null,
      creditAmount: item.unitPrice,
      restockedAt: null,
      statusHistory: [
        {
          from: null,
          to: "requested",
          at: iso(requested),
          by: "customer",
          adminId: null,
          note: null,
        },
        {
          from: "requested",
          to: "approved",
          at: iso(requested + DAY),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
        {
          from: "approved",
          to: "completed",
          at: iso(completed),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
      ],
      updatedAt: iso(completed),
    });
    const refundAt = completed + 2 * HOUR;
    const refund: Refund = {
      id: newId(refundAt),
      refundNumber: `${returned.orderNumber}-RF1`,
      orderId: returned.id,
      orderNumber: returned.orderNumber,
      customerId: returned.customer.id,
      invoiceNumber: returned.payment.invoiceNumber,
      amount: item.unitPrice,
      reason: "return",
      method: "manual",
      status: "pending",
      manual: {
        way: "bank_transfer",
        reference: "SEPA 2026-10-0412",
        paidAt: null,
      },
      stripe: null,
      note: null,
      createdBy: owner.id,
      createdAt: iso(refundAt),
      completedAt: null,
      statusHistory: [
        {
          from: null,
          to: "pending",
          at: iso(refundAt),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
      ],
    };
    db.refunds.push(refund);
    refund.manual!.paidAt = iso(refundAt + DAY);
    completeRefund(db, refund, "admin", owner.id, null, refundAt + DAY);
    queueMessage(
      db,
      {
        type: "return_completed",
        customer,
        order: returned,
        returnId: db.returns[db.returns.length - 1]!.id,
      },
      completed + 3000,
    );
  }

  // Everything of one order came back and went back on the shelf; the
  // refund through Stripe failed, so the admin has to decide again.
  const wholeReturn = delivered[2];
  if (wholeReturn && wholeReturn !== returned && wholeReturn !== corrected) {
    const requested = now - 12 * DAY + 10 * HOUR;
    const completed = requested + 3 * DAY;
    const items = wholeReturn.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      name: item.name,
      packSize: item.packSize,
      quantity: item.quantity,
      approvedQuantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      reason: "wrong_item" as const,
      comment: "The whole parcel was for someone else.",
    }));
    const before = wholeReturn.finalTotals.total;
    for (const item of wholeReturn.items) item.returnedQuantity = item.quantity;
    recomputeFinal(wholeReturn);
    const credit = before - wholeReturn.finalTotals.total;
    restockReturn(
      db,
      wholeReturn,
      items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      completed,
    );
    issueCreditNote(
      db,
      wholeReturn,
      credit,
      "return",
      completed,
      `${wholeReturn.orderNumber}-R1`,
    );
    pushHistory(
      wholeReturn,
      { field: "order", from: "delivered", to: "returned", by: "system" },
      completed,
    );
    wholeReturn.status = "returned";
    db.returns.push({
      id: newId(requested),
      returnNumber: `${wholeReturn.orderNumber}-R1`,
      orderId: wholeReturn.id,
      orderNumber: wholeReturn.orderNumber,
      customerId: wholeReturn.customer.id,
      status: "completed",
      requestedAt: iso(requested),
      decidedAt: iso(requested + 6 * HOUR),
      completedAt: iso(completed),
      items,
      requestedAmount: items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      ),
      customerComment:
        "The parcel was addressed to me but held someone else's order.",
      decisionNote:
        "Sorry for the mix-up. We collect it and credit everything.",
      internalNote: "Label mix-up at the packing table.",
      creditAmount: credit,
      restockedAt: iso(completed),
      statusHistory: [
        {
          from: null,
          to: "requested",
          at: iso(requested),
          by: "customer",
          adminId: null,
          note: null,
        },
        {
          from: "requested",
          to: "approved",
          at: iso(requested + 6 * HOUR),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
        {
          from: "approved",
          to: "completed",
          at: iso(completed),
          by: "admin",
          adminId: owner.id,
          note: "Unopened, back on the shelf.",
        },
      ],
      updatedAt: iso(completed),
    });
    const refundAt = completed + HOUR;
    db.refunds.push({
      id: newId(refundAt),
      refundNumber: `${wholeReturn.orderNumber}-RF1`,
      orderId: wholeReturn.id,
      orderNumber: wholeReturn.orderNumber,
      customerId: wholeReturn.customer.id,
      invoiceNumber: wholeReturn.payment.invoiceNumber,
      amount: credit,
      reason: "return",
      method: "stripe",
      status: "failed",
      manual: null,
      stripe: {
        refundId: `re_3Demo${wholeReturn.orderNumber.slice(3)}`,
        paymentIntentId: wholeReturn.payment.paymentIntentId,
        stripeStatus: "failed",
        failureReason: "insufficient_funds",
      },
      note: null,
      createdBy: owner.id,
      createdAt: iso(refundAt),
      completedAt: null,
      statusHistory: [
        {
          from: null,
          to: "pending",
          at: iso(refundAt),
          by: "admin",
          adminId: owner.id,
          note: null,
        },
        {
          from: "pending",
          to: "processing",
          at: iso(refundAt + 1000),
          by: "stripe",
          adminId: null,
          note: "Stripe: pending",
        },
        {
          from: "processing",
          to: "failed",
          at: iso(refundAt + 2 * HOUR),
          by: "stripe",
          adminId: null,
          note: "Stripe: insufficient_funds",
        },
      ],
    });
  }

  // Three return requests wait for a decision; one is approved and on its way back.
  const askers = delivered.slice(-8, -4);
  askers.forEach((order, index) => {
    const item = order.items[0]!;
    const customer = db.customers.find(
      (entry) => entry.id === order.customer.id,
    )!;
    const requested = now - (index + 1) * 9 * HOUR;
    const approved = index === 3;
    db.returns.push({
      id: newId(requested),
      returnNumber: `${order.orderNumber}-R1`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer.id,
      status: approved ? "approved" : "requested",
      requestedAt: iso(requested),
      decidedAt: approved ? iso(requested + 2 * HOUR) : null,
      completedAt: null,
      items: [
        {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku,
          name: item.name,
          packSize: item.packSize,
          quantity: 1,
          approvedQuantity: approved ? 1 : null,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          reason:
            (["damaged", "wrong_item", "changed_mind", "quality"] as const)[
              index
            ] ?? "other",
          comment:
            [
              "The bag was torn.",
              "I ordered the 5 kg pack.",
              null,
              "Smells off.",
            ][index] ?? null,
        },
      ],
      requestedAmount: item.unitPrice,
      customerComment: index === 0 ? "Please pick it up on Monday." : null,
      decisionNote: approved ? "Send it back with the enclosed label." : null,
      internalNote: null,
      creditAmount: null,
      restockedAt: null,
      statusHistory: [
        {
          from: null,
          to: "requested",
          at: iso(requested),
          by: "customer",
          adminId: null,
          note: null,
        },
        ...(approved
          ? [
              {
                from: "requested" as const,
                to: "approved" as const,
                at: iso(requested + 2 * HOUR),
                by: "admin" as const,
                adminId: owner.id,
                note: null,
              },
            ]
          : []),
      ],
      updatedAt: iso(requested),
    });
    queueMessage(
      db,
      {
        type: "return_requested",
        customer,
        order,
        returnId: db.returns[db.returns.length - 1]!.id,
      },
      requested + 3000,
    );
  });

  // --- Stock: a count, a few pack sizes running low, one sold out ----------
  const sizes = orderable.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  );
  const counted = sizes.filter(
    ({ variant }) => variant.stock.lowStockThreshold !== null,
  );
  counted.slice(0, 3).forEach(({ product, variant }, index) => {
    const target = Math.max(
      0,
      (variant.stock.lowStockThreshold ?? 10) - index * 3,
    );
    recordMovement(
      db,
      product,
      variant,
      "adjustment",
      target - variant.stock.quantity,
      {
        adminId: owner.id,
        note: index === 0 ? "Counted the shelf." : "Broken bags.",
      },
      now - (index + 1) * 5 * HOUR,
    );
  });
  // One pack size of a product with several is sold out: the others stay on sale.
  const soldOut = sizes.find(
    ({ product, variant }) =>
      product.variants.length > 1 &&
      variant.isEnabled &&
      variant.stock.lowStockThreshold === null &&
      variant.stock.quantity > 0,
  );
  if (soldOut) {
    recordMovement(
      db,
      soldOut.product,
      soldOut.variant,
      "adjustment",
      -soldOut.variant.stock.quantity,
      {
        adminId: owner.id,
        note: "Last units given to the food bank: past their date.",
      },
      now - 2 * DAY,
    );
  }
  const restocked = counted[4];
  if (restocked) {
    recordMovement(
      db,
      restocked.product,
      restocked.variant,
      "restock",
      60,
      { adminId: owner.id, note: "Delivery from the importer." },
      now - 6 * HOUR,
    );
  }

  // --- Messages that did not go out ------------------------------------------
  const dispatchEmails = db.notifications.filter(
    (record) =>
      record.type === "order_dispatched" && record.channel === "email",
  );
  for (const record of dispatchEmails.slice(-2)) {
    record.status = "failed";
    record.attempts = 6;
    record.sentAt = null;
    record.providerMessageId = null;
    record.lastError = "554 Message rejected: mailbox unavailable";
    record.history = [
      {
        at: record.createdAt,
        ok: false,
        error: "554 Message rejected: mailbox unavailable",
      },
    ];
    record.updatedAt = iso(now - 3 * HOUR);
  }

  // --- Announcements --------------------------------------------------------
  const mango = db.products.find(
    (product) => product.name.en === "Kesar Mango Box",
  );
  const announce = (
    at: number,
    subject: [string, string],
    message: [string, string],
    productId: string | null,
  ) => {
    const id = newId(at);
    const recipients = db.customers.filter(
      (customer) =>
        customer.communication.marketingOptIn &&
        customer.status === "active" &&
        Date.parse(customer.createdAt) < at,
    );
    const before = db.notifications.length;
    for (const customer of recipients) {
      queueMessage(
        db,
        {
          type: "announcement",
          customer,
          announcementId: id,
          productId: productId ?? undefined,
          channels: ["email", "whatsapp"],
          subject: { en: subject[0], de: subject[1] },
          data: { link: "https://www.radhefoods.de" },
        },
        at + 5000,
      );
    }
    db.announcements.push({
      id,
      subject: { en: subject[0], de: subject[1] },
      message: { en: message[0], de: message[1] },
      link: "https://www.radhefoods.de",
      linkLabel: null,
      productId,
      productName: productId
        ? (db.products.find((product) => product.id === productId)?.name.en ??
          null)
        : null,
      channels: ["email", "whatsapp"],
      recipients: recipients.length,
      queued: db.notifications.length - before,
      createdBy: owner.id,
      cancelledAt: null,
      createdAt: iso(at),
    });
  };
  announce(
    now - 30 * DAY,
    ["Kesar mangoes are back", "Kesar Mangos sind wieder da"],
    [
      "The first Kesar mangoes of the season are in stock now. Order early: the boxes are limited.",
      "Die ersten Kesar Mangos der Saison sind jetzt auf Lager. Bestellen Sie früh: die Kisten sind begrenzt.",
    ],
    mango?.id ?? null,
  );
  announce(
    now - 5 * DAY,
    ["Free delivery from 50 euros", "Kostenlose Lieferung ab 50 Euro"],
    [
      "From now on every order of 50 euros or more is delivered for free, anywhere in Germany.",
      "Ab sofort liefern wir jede Bestellung ab 50 Euro kostenlos, überall in Deutschland.",
    ],
    null,
  );

  // One message is still waiting in the queue.
  const lastOrder = toProcess[toProcess.length - 1];
  const lastCustomer = lastOrder
    ? db.customers.find((entry) => entry.id === lastOrder.customer.id)
    : undefined;
  if (lastOrder && lastCustomer) {
    queueMessage(
      db,
      {
        type: "order_confirmed",
        customer: lastCustomer,
        order: lastOrder,
        outcome: "queued",
      },
      now - 60_000,
    );
  }

  // Every product has a position among the products of its category (7).
  const positions = new Map<string, number>();
  for (const product of db.products) {
    const position = positions.get(product.categoryId) ?? 0;
    product.sortOrder = position;
    positions.set(product.categoryId, position + 1);
  }

  // --- Homepage banners (20) ------------------------------------------------
  const bannerImage = (
    at: number,
    label: string,
    hue: number,
    alt: [string | null, string | null],
  ): AdminImage => {
    const url = (width: number, height: number) =>
      `${options.publicUrl}/media/banner/${hue}/${width}x${height}/${encodeURIComponent(label)}.svg`;
    return {
      id: newId(at + 1),
      alt: { en: alt[0], de: alt[1] },
      isPrimary: false,
      url: url(2400, 1000),
      sizes: {
        small: { url: url(768, 320), width: 768, height: 320 },
        medium: { url: url(1536, 640), width: 1536, height: 640 },
        large: { url: url(2400, 1000), width: 2400, height: 1000 },
      },
      bytes: 380_000 + hue * 200,
      uploadedAt: iso(at),
    };
  };
  const banner = (
    at: number,
    name: string,
    hue: number,
    alt: [string | null, string | null],
    rest: Partial<BannerRecord>,
  ): void => {
    db.banners.push({
      id: newId(at),
      name,
      image: bannerImage(at, name, hue, alt),
      linkUrl: null,
      isActive: true,
      sortOrder: db.banners.length,
      startsAt: null,
      endsAt: null,
      createdAt: iso(at),
      updatedAt: iso(at),
      ...rest,
    });
  };
  const firstCategory = db.categories.find((entry) => entry.parentId === null);
  banner(
    now - 20 * DAY,
    "Diwali offer",
    28,
    ["Diwali offer: sweets and snacks for the festival", "Diwali-Angebot"],
    {
      linkUrl: firstCategory ? `/categories/${firstCategory.slug.en}` : null,
      endsAt: iso(now + 12 * DAY),
    },
  );
  banner(
    now - 9 * DAY,
    "Free delivery from 50 euros",
    150,
    ["Free delivery on every order from 50 euros", null],
    { linkUrl: "https://www.radhefoods.de/delivery" },
  );
  banner(
    now - 3 * DAY,
    "Winter warmers",
    210,
    ["Winter warmers: lentils, rice and spices", "Winterküche"],
    { startsAt: iso(now + 30 * DAY), endsAt: iso(now + 90 * DAY) },
  );
  banner(now - DAY, "Fresh produce (draft)", 95, [null, null], {
    isActive: false,
  });

  // --- FAQ (22) and blog (23) -----------------------------------------------
  seedFaq(db, now);
  seedBlog(db, now, owner);
  // --- The wholesale catalogue (25) and its quotations (24) ------------------
  seedWholesale(db, now, owner.id);
  seedQuotations(db, now, owner);

  return db;
}
