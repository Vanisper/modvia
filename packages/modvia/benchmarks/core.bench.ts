import { describe, expect, test } from "vite-plus/test";
import {
  Alias,
  arrayOf,
  boolean,
  Codec,
  int,
  isoDateTime,
  literal,
  Model,
  number,
  oneOf,
  string,
  type InferData,
  type InferDTO,
} from "modvia";

let sink: unknown;
const BENCH_RUN = { time: 250, warmupTime: 80 } as const;

const trimmedNonEmpty = string().trim().nonEmpty();
const pageIntFromString = int().min(1).max(10_000).fromString();
const timestampCodec = isoDateTime();
const sampleDate = new Date("2026-11-09T08:30:15.250Z");

const UserRole = oneOf("member", "admin", "owner");

const UserModel = Model.define({
  alias: Alias.snakeCase,
  fields: {
    id: string().nonEmpty(),
    displayName: string().trim().nonEmpty(),
    age: int().min(0).max(150),
    isActive: boolean().default(true),
    role: UserRole,
    bio: string().optional(),
    createdAt: isoDateTime(),
  },
});

const StrictUserModel = UserModel.strict();

type UserData = InferData<typeof UserModel>;
type UserDTO = InferDTO<typeof UserModel>;

const validUserDto: UserDTO = {
  id: "usr_01J9Z7K8Q2",
  display_name: "  Lin Zhou  ",
  age: 29,
  role: "admin",
  created_at: "2026-11-09T08:30:15.250Z",
};

const validUserData: UserData = UserModel.parse(validUserDto);

function handWrittenParseUser(input: unknown): UserData {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("type.object");
  }
  const obj = input as Record<string, unknown>;
  if (!Object.hasOwn(obj, "id") || typeof obj.id !== "string" || obj.id.length < 1) {
    throw new Error("id");
  }
  if (!Object.hasOwn(obj, "display_name") || typeof obj.display_name !== "string") {
    throw new Error("display_name");
  }
  const displayName = obj.display_name.trim();
  if (displayName.length < 1) throw new Error("display_name.min");
  if (
    !Object.hasOwn(obj, "age") ||
    typeof obj.age !== "number" ||
    !Number.isSafeInteger(obj.age) ||
    obj.age < 0 ||
    obj.age > 150
  ) {
    throw new Error("age");
  }
  let isActive = true;
  if (Object.hasOwn(obj, "is_active")) {
    if (typeof obj.is_active !== "boolean") throw new Error("is_active");
    isActive = obj.is_active;
  }
  if (
    !Object.hasOwn(obj, "role") ||
    (obj.role !== "member" && obj.role !== "admin" && obj.role !== "owner")
  ) {
    throw new Error("role");
  }
  let bio: string | undefined;
  const hasBio = Object.hasOwn(obj, "bio");
  if (hasBio) {
    if (typeof obj.bio !== "string") throw new Error("bio");
    bio = obj.bio;
  }
  if (!Object.hasOwn(obj, "created_at") || typeof obj.created_at !== "string") {
    throw new Error("created_at");
  }
  const createdAt = new Date(obj.created_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error("datetime");

  return hasBio
    ? {
        id: obj.id,
        displayName,
        age: obj.age,
        isActive,
        role: obj.role,
        bio: bio as string,
        createdAt,
      }
    : {
        id: obj.id,
        displayName,
        age: obj.age,
        isActive,
        role: obj.role,
        createdAt,
      };
}

function handWrittenEncodeUser(input: unknown): UserDTO {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("type.object");
  }
  const user = input as Record<string, unknown>;
  if (!Object.hasOwn(user, "id") || typeof user.id !== "string" || user.id.length < 1) {
    throw new Error("id");
  }
  if (!Object.hasOwn(user, "displayName") || typeof user.displayName !== "string") {
    throw new Error("displayName");
  }
  const displayName = user.displayName.trim();
  if (displayName.length < 1) throw new Error("displayName.min");
  if (
    !Object.hasOwn(user, "age") ||
    typeof user.age !== "number" ||
    !Number.isSafeInteger(user.age) ||
    user.age < 0 ||
    user.age > 150
  ) {
    throw new Error("age");
  }
  if (!Object.hasOwn(user, "isActive") || typeof user.isActive !== "boolean") {
    throw new Error("isActive");
  }
  if (
    !Object.hasOwn(user, "role") ||
    (user.role !== "member" && user.role !== "admin" && user.role !== "owner")
  ) {
    throw new Error("role");
  }
  const hasBio = Object.hasOwn(user, "bio");
  if (hasBio && typeof user.bio !== "string") {
    throw new Error("bio");
  }
  if (
    !Object.hasOwn(user, "createdAt") ||
    !(user.createdAt instanceof Date) ||
    Number.isNaN(user.createdAt.getTime())
  ) {
    throw new Error("createdAt");
  }

  return hasBio
    ? {
        id: user.id,
        display_name: displayName,
        age: user.age,
        is_active: user.isActive,
        role: user.role,
        bio: user.bio as string,
        created_at: user.createdAt.toISOString(),
      }
    : {
        id: user.id,
        display_name: displayName,
        age: user.age,
        is_active: user.isActive,
        role: user.role,
        created_at: user.createdAt.toISOString(),
      };
}

const AddressModel = Model.define({
  alias: Alias.snakeCase,
  fields: {
    countryCode: string().length(2),
    city: string().nonEmpty(),
    postalCode: string().nonEmpty(),
    streetLine: string().nonEmpty(),
  },
});

const OrderItemModel = Model.define({
  alias: Alias.snakeCase,
  fields: {
    sku: string().nonEmpty(),
    quantity: int().min(1).max(999),
    unitPriceCents: int().nonNegative(),
    discountRate: number().min(0).max(1).optional(),
  },
});

const OrderModel = Model.define({
  alias: Alias.snakeCase,
  fields: {
    orderId: string().nonEmpty(),
    customerId: string().nonEmpty(),
    shippingAddress: AddressModel,
    items: arrayOf(OrderItemModel).nonEmpty(),
    placedAt: isoDateTime(),
  },
});

const validOrderDto: InferDTO<typeof OrderModel> = {
  order_id: "ord_20261109_001",
  customer_id: "cus_8891",
  shipping_address: {
    country_code: "CN",
    city: "Hangzhou",
    postal_code: "310000",
    street_line: "No. 18 West Lake Ave",
  },
  items: Array.from({ length: 100 }, (_, index) => ({
    sku: `SKU-${1000 + index}`,
    quantity: (index % 5) + 1,
    unit_price_cents: 1990 + index * 10,
    ...(index % 3 === 0 ? { discount_rate: 0.1 } : {}),
  })),
  placed_at: "2026-11-09T09:15:00.000Z",
};

const validOrderData = OrderModel.parse(validOrderDto);

const invalidOrderDto = {
  ...validOrderDto,
  items: Array.from({ length: 100 }, (_, index) => ({
    sku: "",
    quantity: -index,
    unit_price_cents: 1990,
  })),
};

class LineItemEntity {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPriceCents: number;

  constructor(data: { sku: string; quantity: number; unitPriceCents: number }) {
    this.sku = data.sku;
    this.quantity = data.quantity;
    this.unitPriceCents = data.unitPriceCents;
  }

  get subtotalCents(): number {
    return this.quantity * this.unitPriceCents;
  }
}

const LineItemInputModel = Model.define({
  alias: Alias.snakeCase,
  fields: {
    sku: string().nonEmpty(),
    quantity: int().positive(),
    unitPriceCents: int().nonNegative(),
  },
}).withFactory((data) => new LineItemEntity(data));

const LineItemSummaryModel = Model.define({
  alias: Alias.snakeCase,
  fields: {
    sku: string().nonEmpty(),
    quantity: int().positive(),
    unitPriceCents: int().nonNegative(),
    subtotalCents: int().nonNegative(),
  },
});

const sampleEntity = LineItemInputModel.parse({
  sku: "SKU-PRO-01",
  quantity: 4,
  unit_price_cents: 2500,
});

const eventBranches = [
  Model.define({ fields: { type: literal("ev.1"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.2"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.3"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.4"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.5"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.6"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.7"), id: string(), seq: int() } }),
  Model.define({
    alias: Alias.snakeCase,
    fields: {
      type: literal("invoice.paid"),
      invoiceId: string().nonEmpty(),
      amountCents: int().nonNegative(),
      paidAt: isoDateTime(),
    },
  }),
] as const;

const TaggedEventUnion = Model.union("type", eventBranches);
const SequentialEventUnion = Codec.union(...eventBranches);

const eighthVariantDto = {
  type: "invoice.paid" as const,
  invoice_id: "inv_9001",
  amount_cents: 49_900,
  paid_at: "2026-11-09T10:00:00.000Z",
};
const eighthVariantData = TaggedEventUnion.parse(eighthVariantDto);

describe("Modvia 核心热路径基准测试", () => {
  test("标量与字符串介质编解码", { timeout: 30_000 }, async ({ bench }) => {
    await bench.compare(
      bench("string().trim().nonEmpty() parse", () => {
        sink = trimmedNonEmpty.parse("  modvia-core  ");
      }),
      bench("int().min().max().fromString() parse", () => {
        sink = pageIntFromString.parse("42");
      }),
      bench("isoDateTime() parse (string -> Date)", () => {
        sink = timestampCodec.parse("2026-11-09T08:30:15.250Z");
      }),
      bench("isoDateTime() encode (Date -> string)", () => {
        sink = timestampCodec.encode(sampleDate);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test("扁平 DTO 模型双向编解码", { timeout: 30_000 }, async ({ bench }) => {
    await bench.compare(
      bench("hand-written parse baseline", () => {
        sink = handWrittenParseUser(validUserDto);
      }),
      bench("Model.parse (lenient + alias + default)", () => {
        sink = UserModel.parse(validUserDto);
      }),
      bench("Model.safeParse (frozen SafeResult)", () => {
        sink = UserModel.safeParse(validUserDto);
      }),
      bench("Model.strict().parse", () => {
        sink = StrictUserModel.parse(validUserDto);
      }),
      bench("hand-written encode baseline", () => {
        sink = handWrittenEncodeUser(validUserData);
      }),
      bench("Model.encode (Data -> snake_case DTO)", () => {
        sink = UserModel.encode(validUserData);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test("嵌套模型与 100 元素数组双向编解码", { timeout: 30_000 }, async ({ bench }) => {
    await bench.compare(
      bench("Order (nested + 100 items) parse", () => {
        sink = OrderModel.parse(validOrderDto);
      }),
      bench("Order (nested + 100 items) encode", () => {
        sink = OrderModel.encode(validOrderData);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test("withFactory 实体构造与原型链 Getter 编码", { timeout: 30_000 }, async ({ bench }) => {
    await bench.compare(
      bench("withFactory parse -> class instance", () => {
        sink = LineItemInputModel.parse({
          sku: "SKU-PRO-01",
          quantity: 4,
          unit_price_cents: 2500,
        });
      }),
      bench("Model.encode reading prototype getter", () => {
        sink = LineItemSummaryModel.encode(sampleEntity);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test(
    "多态联合：8 分支尾项命中 (Model.union O(1) vs Codec.union)",
    { timeout: 30_000 },
    async ({ bench }) => {
      await bench.compare(
        bench("Model.union O(1) parse (8th branch)", () => {
          sink = TaggedEventUnion.parse(eighthVariantDto);
        }),
        bench("Codec.union sequential parse (8th branch)", () => {
          sink = SequentialEventUnion.parse(eighthVariantDto);
        }),
        bench("Model.union O(1) encode (8th branch)", () => {
          sink = TaggedEventUnion.encode(eighthVariantData);
        }),
        bench("Codec.union sequential encode (8th branch)", () => {
          sink = SequentialEventUnion.encode(eighthVariantData);
        }),
        BENCH_RUN,
      );
      expect(sink).toBeDefined();
    },
  );

  test(
    "大规模校验失败收集（100 元素共 200 条路径错误）",
    { timeout: 30_000 },
    async ({ bench }) => {
      await bench.compare(
        bench("safeParse (200 issues, zero stack allocation)", () => {
          sink = OrderModel.safeParse(invalidOrderDto);
        }),
        bench("parse try/catch (200 issues, 1 boundary Error)", () => {
          try {
            sink = OrderModel.parse(invalidOrderDto);
          } catch (err) {
            sink = err;
          }
        }),
        BENCH_RUN,
      );
      expect(sink).toBeDefined();
    },
  );
});
