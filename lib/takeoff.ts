export const TAKEOFF_CATEGORIES = [
  "Floor",
  "Wall",
  "Shower",
  "Tub surround",
  "Base",
  "Niche",
  "Bench",
  "Ceiling",
  "Stairs",
  "Custom",
] as const;

export const TAKEOFF_UNITS = ["sf", "lf", "ea", "set", "allowance"] as const;

export const TAKEOFF_SOURCE_TYPES = ["manual", "drawing", "photo", "note", "document"] as const;

export type TakeoffCategory = (typeof TAKEOFF_CATEGORIES)[number];
export type TakeoffUnit = (typeof TAKEOFF_UNITS)[number];
export type TakeoffSourceType = (typeof TAKEOFF_SOURCE_TYPES)[number];

export type TakeoffItem = {
  id: string;
  name: string;
  category: TakeoffCategory;
  location: string;
  quantity: number;
  unit: TakeoffUnit;
  length: number;
  width: number;
  height: number;
  deduction: number;
  wastePercent: number;
  calculatedQuantity: number;
  notes: string;
  sourceType: TakeoffSourceType;
  sourceFile: string;
  linkedAssemblyIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type TakeoffGroup = {
  id: string;
  key: string;
  name: string;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TakeoffSettings = {
  defaultWastePercent: number;
  showAdvancedFields: boolean;
  groupBy: "location";
};

const numberFromUnknown = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const nonNegative = (value: unknown, fallback = 0) => Math.max(0, numberFromUnknown(value, fallback));

const safeText = (value: unknown, maxLength = 1000) =>
  (typeof value === "string" ? value : "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, maxLength);

const safeIso = (value: unknown) => {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) {
    return new Date().toISOString();
  }
  return new Date(time).toISOString();
};

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const roundQuantity = (value: number) => Number(value.toFixed(3));

export const validTakeoffCategory = (value: unknown): TakeoffCategory => {
  if (TAKEOFF_CATEGORIES.includes(value as TakeoffCategory)) {
    return value as TakeoffCategory;
  }
  return "Custom";
};

export const validTakeoffUnit = (value: unknown): TakeoffUnit => {
  if (TAKEOFF_UNITS.includes(value as TakeoffUnit)) {
    return value as TakeoffUnit;
  }
  return "sf";
};

export const validTakeoffSourceType = (value: unknown): TakeoffSourceType => {
  if (TAKEOFF_SOURCE_TYPES.includes(value as TakeoffSourceType)) {
    return value as TakeoffSourceType;
  }
  return "manual";
};

export const defaultTakeoffSettings = (): TakeoffSettings => ({
  defaultWastePercent: 10,
  showAdvancedFields: false,
  groupBy: "location",
});

export const calculateTakeoffQuantities = (input: {
  quantity: unknown;
  length: unknown;
  width: unknown;
  height: unknown;
  deduction: unknown;
  wastePercent: unknown;
}) => {
  const quantity = nonNegative(input.quantity);
  const length = nonNegative(input.length);
  const width = nonNegative(input.width);
  const height = nonNegative(input.height);
  const deduction = nonNegative(input.deduction);
  const wastePercent = nonNegative(input.wastePercent);

  let base = quantity;
  let formula: "direct" | "length-width" | "width-height" = "direct";

  if (base <= 0 && length > 0 && width > 0) {
    base = length * width;
    formula = "length-width";
  } else if (base <= 0 && width > 0 && height > 0) {
    base = width * height;
    formula = "width-height";
  }

  const netQuantity = Math.max(0, base - deduction);
  const finalQuantity = netQuantity * (1 + wastePercent / 100);

  return {
    formula,
    netQuantity: roundQuantity(netQuantity),
    finalQuantity: roundQuantity(finalQuantity),
  };
};

export const buildTakeoffGroupKey = (location: unknown) => {
  const clean = safeText(location, 120);
  if (!clean) {
    return "unassigned";
  }
  return clean.toLowerCase();
};

export const createEmptyTakeoffItem = (settings?: Partial<TakeoffSettings>): TakeoffItem => {
  const now = new Date().toISOString();
  const wastePercent = nonNegative(settings?.defaultWastePercent ?? defaultTakeoffSettings().defaultWastePercent);
  const quantities = calculateTakeoffQuantities({
    quantity: 0,
    length: 0,
    width: 0,
    height: 0,
    deduction: 0,
    wastePercent,
  });

  return {
    id: makeId(),
    name: "",
    category: "Floor",
    location: "",
    quantity: 0,
    unit: "sf",
    length: 0,
    width: 0,
    height: 0,
    deduction: 0,
    wastePercent,
    calculatedQuantity: quantities.finalQuantity,
    notes: "",
    sourceType: "manual",
    sourceFile: "",
    linkedAssemblyIds: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const normalizeTakeoffItem = (raw: unknown, settings?: Partial<TakeoffSettings>): TakeoffItem | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const name = safeText(source.name, 200);
  const now = new Date().toISOString();
  const wastePercent = nonNegative(
    source.wastePercent,
    nonNegative(settings?.defaultWastePercent ?? defaultTakeoffSettings().defaultWastePercent),
  );

  const quantities = calculateTakeoffQuantities({
    quantity: source.quantity,
    length: source.length,
    width: source.width,
    height: source.height,
    deduction: source.deduction,
    wastePercent,
  });

  const linkedAssemblyIds = Array.isArray(source.linkedAssemblyIds)
    ? source.linkedAssemblyIds
        .map((value) => safeText(value, 120))
        .filter(Boolean)
    : [];

  return {
    id: safeText(source.id, 120) || makeId(),
    name: name || "Untitled takeoff item",
    category: validTakeoffCategory(source.category),
    location: safeText(source.location, 200),
    quantity: nonNegative(source.quantity),
    unit: validTakeoffUnit(source.unit),
    length: nonNegative(source.length),
    width: nonNegative(source.width),
    height: nonNegative(source.height),
    deduction: nonNegative(source.deduction),
    wastePercent,
    calculatedQuantity: roundQuantity(nonNegative(source.calculatedQuantity, quantities.finalQuantity)),
    notes: safeText(source.notes, 3000),
    sourceType: validTakeoffSourceType(source.sourceType),
    sourceFile: safeText(source.sourceFile, 260),
    linkedAssemblyIds: Array.from(new Set(linkedAssemblyIds)),
    createdAt: safeIso(source.createdAt ?? now),
    updatedAt: safeIso(source.updatedAt ?? now),
  };
};

export const normalizeTakeoffItems = (raw: unknown, settings?: Partial<TakeoffSettings>) => {
  if (!Array.isArray(raw)) {
    return [] as TakeoffItem[];
  }

  return raw
    .map((item) => normalizeTakeoffItem(item, settings))
    .filter((item): item is TakeoffItem => Boolean(item));
};

export const normalizeTakeoffGroup = (raw: unknown): TakeoffGroup | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  const name = safeText(source.name, 120) || "Unassigned";

  return {
    id: safeText(source.id, 120) || makeId(),
    key: safeText(source.key, 120) || buildTakeoffGroupKey(name),
    name,
    collapsed: source.collapsed === true,
    createdAt: safeIso(source.createdAt ?? now),
    updatedAt: safeIso(source.updatedAt ?? now),
  };
};

export const normalizeTakeoffGroups = (raw: unknown) => {
  if (!Array.isArray(raw)) {
    return [] as TakeoffGroup[];
  }

  return raw
    .map(normalizeTakeoffGroup)
    .filter((item): item is TakeoffGroup => Boolean(item));
};

export const normalizeTakeoffSettings = (raw: unknown): TakeoffSettings => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const defaults = defaultTakeoffSettings();

  return {
    defaultWastePercent: nonNegative(source.defaultWastePercent, defaults.defaultWastePercent),
    showAdvancedFields: source.showAdvancedFields === true,
    groupBy: "location",
  };
};

export const syncTakeoffGroupsWithItems = (items: TakeoffItem[], groups: TakeoffGroup[]) => {
  const now = new Date().toISOString();
  const byKey = new Map(groups.map((group) => [group.key, group]));

  const keys = new Set<string>();
  for (const item of items) {
    keys.add(buildTakeoffGroupKey(item.location));
  }

  if (keys.size === 0) {
    return [] as TakeoffGroup[];
  }

  const nextGroups: TakeoffGroup[] = [];
  for (const key of keys) {
    const existing = byKey.get(key);
    const title = key === "unassigned" ? "Unassigned" : (items.find((item) => buildTakeoffGroupKey(item.location) === key)?.location || "Unassigned");

    if (existing) {
      nextGroups.push({
        ...existing,
        name: title,
        updatedAt: now,
      });
      continue;
    }

    nextGroups.push({
      id: makeId(),
      key,
      name: title,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return nextGroups.sort((a, b) => {
    if (a.key === "unassigned") return 1;
    if (b.key === "unassigned") return -1;
    return a.name.localeCompare(b.name);
  });
};

export const withUpdatedTakeoffItem = (item: TakeoffItem): TakeoffItem => {
  const quantities = calculateTakeoffQuantities(item);
  return {
    ...item,
    quantity: nonNegative(item.quantity),
    length: nonNegative(item.length),
    width: nonNegative(item.width),
    height: nonNegative(item.height),
    deduction: nonNegative(item.deduction),
    wastePercent: nonNegative(item.wastePercent),
    calculatedQuantity: quantities.finalQuantity,
    updatedAt: new Date().toISOString(),
  };
};

export const summarizeTakeoffByUnit = (items: TakeoffItem[]) => {
  const totals: Record<TakeoffUnit, { net: number; final: number }> = {
    sf: { net: 0, final: 0 },
    lf: { net: 0, final: 0 },
    ea: { net: 0, final: 0 },
    set: { net: 0, final: 0 },
    allowance: { net: 0, final: 0 },
  };

  for (const item of items) {
    const quantities = calculateTakeoffQuantities(item);
    totals[item.unit].net = roundQuantity(totals[item.unit].net + quantities.netQuantity);
    totals[item.unit].final = roundQuantity(totals[item.unit].final + item.calculatedQuantity);
  }

  return totals;
};
