export const ASSEMBLY_CATEGORIES = [
  "Tile installation",
  "Waterproofing",
  "Floor preparation",
  "Demolition",
  "Heated floor",
  "Grouting",
  "Caulking",
  "Baseboard",
  "Custom",
] as const;

export const ASSEMBLY_UNITS = ["sf", "lf", "ea", "bag", "sheet", "hour", "day", "allowance"] as const;

export type AssemblyCategory = (typeof ASSEMBLY_CATEGORIES)[number];
export type AssemblyUnit = (typeof ASSEMBLY_UNITS)[number];

export type TaxHandling = "exclusive" | "included" | "exempt";

export type AssemblyLineItem = {
  id: string;
  description: string;
  quantity: number;
  unit: AssemblyUnit;
  unitCost: number;
  total: number;
  source: string;
  notes: string;
};

export type TakeoffAssemblyControl = {
  takeoffItemId: string;
  takeoffItemName: string;
  unit: string;
  linkedAt: string;
};

export type ProjectAssemblyRecord = {
  id: string;
  sourceTemplateId?: string;
  takeoffControl?: TakeoffAssemblyControl;
  name: string;
  category: AssemblyCategory;
  description: string;
  quantity: number;
  unit: AssemblyUnit;
  labourItems: AssemblyLineItem[];
  materialItems: AssemblyLineItem[];
  equipmentItems: AssemblyLineItem[];
  subcontractItems: AssemblyLineItem[];
  wastePercent: number;
  markupPercent: number;
  taxHandling: TaxHandling;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AssemblyLibraryTemplate = Omit<ProjectAssemblyRecord, "sourceTemplateId" | "takeoffControl"> & {
  archivedAt: string | null;
};

export type AssemblyLibraryData = {
  schemaVersion: number;
  templates: AssemblyLibraryTemplate[];
  archivedTemplates: AssemblyLibraryTemplate[];
  updatedAt: string;
};

export const ASSEMBLY_LIBRARY_SCHEMA_VERSION = 1;

export type AssemblyTotals = {
  labourSubtotal: number;
  materialSubtotal: number;
  equipmentSubtotal: number;
  subcontractSubtotal: number;
  wasteAmount: number;
  markupAmount: number;
  preTaxTotal: number;
  total: number;
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

const validUnit = (value: unknown): AssemblyUnit => {
  if (ASSEMBLY_UNITS.includes(value as AssemblyUnit)) {
    return value as AssemblyUnit;
  }
  return "ea";
};

const validCategory = (value: unknown): AssemblyCategory => {
  if (ASSEMBLY_CATEGORIES.includes(value as AssemblyCategory)) {
    return value as AssemblyCategory;
  }
  return "Custom";
};

const validTaxHandling = (value: unknown): TaxHandling => {
  if (value === "exclusive" || value === "included" || value === "exempt") {
    return value;
  }
  return "exclusive";
};

const safeIso = (value: unknown) => {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) {
    return new Date().toISOString();
  }
  return new Date(time).toISOString();
};

const normalizeTakeoffControl = (value: unknown): TakeoffAssemblyControl | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const takeoffItemId = safeText(source.takeoffItemId, 120);
  if (!takeoffItemId) {
    return undefined;
  }

  return {
    takeoffItemId,
    takeoffItemName: safeText(source.takeoffItemName, 200) || "Takeoff item",
    unit: safeText(source.unit, 40) || "sf",
    linkedAt: safeIso(source.linkedAt),
  };
};

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createEmptyLineItem = (): AssemblyLineItem => ({
  id: makeId(),
  description: "",
  quantity: 1,
  unit: "ea",
  unitCost: 0,
  total: 0,
  source: "",
  notes: "",
});

export const calculateLineItemTotal = (item: Pick<AssemblyLineItem, "quantity" | "unitCost">) => {
  const quantity = nonNegative(item.quantity);
  const unitCost = nonNegative(item.unitCost);
  return Number((quantity * unitCost).toFixed(2));
};

export const normalizeLineItem = (raw: unknown): AssemblyLineItem | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const quantity = nonNegative(source.quantity, 1);
  const unitCost = nonNegative(source.unitCost);

  return {
    id: safeText(source.id, 120) || makeId(),
    description: safeText(source.description, 500),
    quantity,
    unit: validUnit(source.unit),
    unitCost,
    total: calculateLineItemTotal({ quantity, unitCost }),
    source: safeText(source.source, 200),
    notes: safeText(source.notes, 2000),
  };
};

export const normalizeLineItems = (raw: unknown) => {
  if (!Array.isArray(raw)) {
    return [] as AssemblyLineItem[];
  }
  return raw.map(normalizeLineItem).filter((item): item is AssemblyLineItem => Boolean(item));
};

export const createEmptyAssembly = (): ProjectAssemblyRecord => {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    name: "",
    category: "Custom",
    description: "",
    quantity: 1,
    unit: "ea",
    labourItems: [],
    materialItems: [],
    equipmentItems: [],
    subcontractItems: [],
    wastePercent: 0,
    markupPercent: 0,
    taxHandling: "exclusive",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeLegacyAssembly = (source: Record<string, unknown>): ProjectAssemblyRecord => {
  const now = new Date().toISOString();
  const legacyInfo = source.assembly && typeof source.assembly === "object"
    ? (source.assembly as Record<string, unknown>)
    : {};

  return {
    id: safeText(source.id, 120) || makeId(),
    name: safeText(legacyInfo.name, 200) || "Untitled assembly",
    category: validCategory(legacyInfo.category),
    description: safeText(legacyInfo.projectContext, 1000),
    quantity: 1,
    unit: "ea",
    labourItems: [],
    materialItems: [],
    equipmentItems: [],
    subcontractItems: [],
    wastePercent: 0,
    markupPercent: 0,
    taxHandling: "exclusive",
    notes: safeText(legacyInfo.notes, 3000),
    createdAt: safeIso(source.createdAt ?? now),
    updatedAt: safeIso(source.updatedAt ?? now),
  };
};

export const normalizeAssemblyRecord = (raw: unknown): ProjectAssemblyRecord | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;

  // Backward compatibility for previous assembly shape.
  if (source.assembly && typeof source.assembly === "object") {
    return normalizeLegacyAssembly(source);
  }

  const now = new Date().toISOString();
  const quantity = nonNegative(source.quantity, 1);

  const normalized: ProjectAssemblyRecord = {
    id: safeText(source.id, 120) || makeId(),
    sourceTemplateId: safeText(source.sourceTemplateId, 120) || undefined,
    takeoffControl: normalizeTakeoffControl(source.takeoffControl),
    name: safeText(source.name, 200) || "Untitled assembly",
    category: validCategory(source.category),
    description: safeText(source.description, 1000),
    quantity,
    unit: validUnit(source.unit),
    labourItems: normalizeLineItems(source.labourItems),
    materialItems: normalizeLineItems(source.materialItems),
    equipmentItems: normalizeLineItems(source.equipmentItems),
    subcontractItems: normalizeLineItems(source.subcontractItems),
    wastePercent: nonNegative(source.wastePercent),
    markupPercent: nonNegative(source.markupPercent),
    taxHandling: validTaxHandling(source.taxHandling),
    notes: safeText(source.notes, 3000),
    createdAt: safeIso(source.createdAt ?? now),
    updatedAt: safeIso(source.updatedAt ?? now),
  };

  return applyAssemblyCalculations(normalized);
};

export const normalizeAssemblies = (raw: unknown): ProjectAssemblyRecord[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map(normalizeAssemblyRecord)
    .filter((assembly): assembly is ProjectAssemblyRecord => Boolean(assembly));
};

const sumItems = (items: AssemblyLineItem[]) => items.reduce((sum, item) => sum + calculateLineItemTotal(item), 0);

export const calculateAssemblyTotals = (assembly: ProjectAssemblyRecord): AssemblyTotals => {
  const labourSubtotal = Number(sumItems(assembly.labourItems).toFixed(2));
  const materialSubtotal = Number(sumItems(assembly.materialItems).toFixed(2));
  const equipmentSubtotal = Number(sumItems(assembly.equipmentItems).toFixed(2));
  const subcontractSubtotal = Number(sumItems(assembly.subcontractItems).toFixed(2));

  // Assumption: waste is applied to materials, equipment, and subcontract values only.
  const wasteBase = materialSubtotal + equipmentSubtotal + subcontractSubtotal;
  const wasteAmount = Number((wasteBase * (nonNegative(assembly.wastePercent) / 100)).toFixed(2));

  const markupBase = labourSubtotal + materialSubtotal + equipmentSubtotal + subcontractSubtotal + wasteAmount;
  const markupAmount = Number((markupBase * (nonNegative(assembly.markupPercent) / 100)).toFixed(2));
  const preTaxTotal = Number((markupBase + markupAmount).toFixed(2));

  return {
    labourSubtotal,
    materialSubtotal,
    equipmentSubtotal,
    subcontractSubtotal,
    wasteAmount,
    markupAmount,
    preTaxTotal,
    total: preTaxTotal,
  };
};

export const applyAssemblyCalculations = (
  assembly: ProjectAssemblyRecord,
  options: { preserveDraftText?: boolean } = {},
): ProjectAssemblyRecord => {
  const normalizeText = options.preserveDraftText
    ? (value: unknown, maxLength: number) => (
        (typeof value === "string" ? value : "")
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
          .slice(0, maxLength)
      )
    : safeText;

  const normalizeItems = (items: AssemblyLineItem[]) => items.map((item) => {
    const quantity = nonNegative(item.quantity, 1);
    const unitCost = nonNegative(item.unitCost);
    return {
      ...item,
      quantity,
      unitCost,
      total: calculateLineItemTotal({ quantity, unitCost }),
      unit: validUnit(item.unit),
      description: normalizeText(item.description, 500),
      source: normalizeText(item.source, 200),
      notes: normalizeText(item.notes, 2000),
    };
  });

  return {
    ...assembly,
    sourceTemplateId: normalizeText(assembly.sourceTemplateId, 120) || undefined,
    takeoffControl: normalizeTakeoffControl(assembly.takeoffControl),
    name: normalizeText(assembly.name, 200),
    category: validCategory(assembly.category),
    description: normalizeText(assembly.description, 1000),
    quantity: nonNegative(assembly.quantity, 1),
    unit: validUnit(assembly.unit),
    labourItems: normalizeItems(assembly.labourItems),
    materialItems: normalizeItems(assembly.materialItems),
    equipmentItems: normalizeItems(assembly.equipmentItems),
    subcontractItems: normalizeItems(assembly.subcontractItems),
    wastePercent: nonNegative(assembly.wastePercent),
    markupPercent: nonNegative(assembly.markupPercent),
    taxHandling: validTaxHandling(assembly.taxHandling),
    notes: normalizeText(assembly.notes, 3000),
    createdAt: safeIso(assembly.createdAt),
    updatedAt: safeIso(assembly.updatedAt),
  };
};

export const cloneAssembly = (assembly: ProjectAssemblyRecord): ProjectAssemblyRecord => {
  const now = new Date().toISOString();
  const next = applyAssemblyCalculations({
    ...assembly,
    id: makeId(),
    name: `${assembly.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
    labourItems: assembly.labourItems.map((item) => ({ ...item, id: makeId() })),
    materialItems: assembly.materialItems.map((item) => ({ ...item, id: makeId() })),
    equipmentItems: assembly.equipmentItems.map((item) => ({ ...item, id: makeId() })),
    subcontractItems: assembly.subcontractItems.map((item) => ({ ...item, id: makeId() })),
  });

  return next;
};

export const normalizeLibraryTemplate = (raw: unknown): AssemblyLibraryTemplate | null => {
  const normalized = normalizeAssemblyRecord(raw);
  if (!normalized) {
    return null;
  }

  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const { sourceTemplateId: _sourceTemplateId, takeoffControl: _takeoffControl, ...templateBase } = normalized;
  void _sourceTemplateId;
  void _takeoffControl;

  return {
    ...templateBase,
    archivedAt: typeof source.archivedAt === "string" ? safeIso(source.archivedAt) : null,
  };
};

export const normalizeLibraryTemplates = (raw: unknown): AssemblyLibraryTemplate[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map(normalizeLibraryTemplate)
    .filter((template): template is AssemblyLibraryTemplate => Boolean(template));
};

export const createTemplateFromProjectAssembly = (assembly: ProjectAssemblyRecord): AssemblyLibraryTemplate => {
  const now = new Date().toISOString();
  const normalized = applyAssemblyCalculations({
    ...assembly,
    id: makeId(),
    sourceTemplateId: undefined,
    takeoffControl: undefined,
    createdAt: now,
    updatedAt: now,
  });
  const { sourceTemplateId: _sourceTemplateId, takeoffControl: _takeoffControl, ...templateBase } = normalized;
  void _sourceTemplateId;
  void _takeoffControl;

  return {
    ...templateBase,
    archivedAt: null,
  };
};

export const createProjectAssemblyFromTemplate = (template: AssemblyLibraryTemplate): ProjectAssemblyRecord => {
  const now = new Date().toISOString();
  const normalized = applyAssemblyCalculations({
    ...template,
    id: makeId(),
    sourceTemplateId: template.id,
    takeoffControl: undefined,
    createdAt: now,
    updatedAt: now,
  });

  return normalized;
};

export const cloneTemplate = (template: AssemblyLibraryTemplate): AssemblyLibraryTemplate => {
  const now = new Date().toISOString();
  const cloned = applyAssemblyCalculations({
    ...template,
    id: makeId(),
    sourceTemplateId: undefined,
    takeoffControl: undefined,
    name: `${template.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
    labourItems: template.labourItems.map((item) => ({ ...item, id: makeId() })),
    materialItems: template.materialItems.map((item) => ({ ...item, id: makeId() })),
    equipmentItems: template.equipmentItems.map((item) => ({ ...item, id: makeId() })),
    subcontractItems: template.subcontractItems.map((item) => ({ ...item, id: makeId() })),
  });
  const { sourceTemplateId: _sourceTemplateId, takeoffControl: _takeoffControl, ...templateBase } = cloned;
  void _sourceTemplateId;
  void _takeoffControl;

  return {
    ...templateBase,
    archivedAt: null,
  };
};

export const withUpdatedTimestamp = (assembly: ProjectAssemblyRecord): ProjectAssemblyRecord => ({
  ...assembly,
  updatedAt: new Date().toISOString(),
});

export const assemblySummaryText = (assembly: ProjectAssemblyRecord) => {
  const totals = calculateAssemblyTotals(assembly);
  return {
    labour: totals.labourSubtotal,
    material: totals.materialSubtotal,
    markup: totals.markupAmount,
    total: totals.total,
  };
};

export const isMeaningfullyDifferentAssembly = (
  original: ProjectAssemblyRecord,
  next: ProjectAssemblyRecord,
) => {
  const serialize = (value: ProjectAssemblyRecord) => JSON.stringify({
    name: value.name,
    category: value.category,
    description: value.description,
    takeoffControl: value.takeoffControl,
    quantity: value.quantity,
    unit: value.unit,
    labourItems: value.labourItems,
    materialItems: value.materialItems,
    equipmentItems: value.equipmentItems,
    subcontractItems: value.subcontractItems,
    wastePercent: value.wastePercent,
    markupPercent: value.markupPercent,
    taxHandling: value.taxHandling,
    notes: value.notes,
  });

  return serialize(original) !== serialize(next);
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
