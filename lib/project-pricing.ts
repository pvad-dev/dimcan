import { calculateAssemblyTotals, type ProjectAssemblyRecord } from "./assembly-estimating";
import type { TakeoffItem } from "./takeoff";

export const PRICING_ADJUSTMENT_TYPES = [
  "allowance",
  "discount",
  "contingency",
  "overhead",
  "custom",
] as const;

export const PRICING_ADJUSTMENT_AMOUNT_TYPES = ["fixed", "percent"] as const;

export const PRICING_TAX_BASES = ["costSubtotal", "sellingSubtotal", "preTaxSubtotal"] as const;

export type PricingAdjustmentType = (typeof PRICING_ADJUSTMENT_TYPES)[number];
export type PricingAdjustmentAmountType = (typeof PRICING_ADJUSTMENT_AMOUNT_TYPES)[number];
export type PricingTaxBase = (typeof PRICING_TAX_BASES)[number];

export type PricingSettings = {
  pstEnabled: boolean;
  pstRate: number;
  pstAppliesTo: PricingTaxBase;
  gstEnabled: boolean;
  gstRate: number;
  gstAppliesTo: PricingTaxBase;
  adjustmentPercentBase: "costSubtotal" | "sellingSubtotal";
};

export type PricingAdjustment = {
  id: string;
  name: string;
  type: PricingAdjustmentType;
  amountType: PricingAdjustmentAmountType;
  value: number;
  notes: string;
  enabled: boolean;
};

export type AppliedPricingAdjustment = PricingAdjustment & {
  baseAmount: number;
  amount: number;
};

export type PricingIncompleteAssembly = {
  assemblyId: string;
  assemblyName: string;
  reasons: string[];
};

export type PricingSummary = {
  labourSubtotal: number;
  materialSubtotal: number;
  equipmentSubtotal: number;
  subcontractSubtotal: number;
  costSubtotal: number;
  assemblyMarkup: number;
  sellingSubtotal: number;
  projectAdjustments: AppliedPricingAdjustment[];
  projectAdjustmentsTotal: number;
  preTaxSubtotal: number;
  pst: number;
  gst: number;
  finalProjectTotal: number;
  taxExplanations: {
    pst: string;
    gst: string;
  };
  incompleteAssemblies: PricingIncompleteAssembly[];
  hasIncompletePricing: boolean;
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

const roundMoney = (value: number) => Number(value.toFixed(2));

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const validAdjustmentType = (value: unknown): PricingAdjustmentType => {
  if (PRICING_ADJUSTMENT_TYPES.includes(value as PricingAdjustmentType)) {
    return value as PricingAdjustmentType;
  }
  return "custom";
};

const validAdjustmentAmountType = (value: unknown): PricingAdjustmentAmountType => {
  if (PRICING_ADJUSTMENT_AMOUNT_TYPES.includes(value as PricingAdjustmentAmountType)) {
    return value as PricingAdjustmentAmountType;
  }
  return "fixed";
};

const validTaxBase = (value: unknown): PricingTaxBase => {
  if (PRICING_TAX_BASES.includes(value as PricingTaxBase)) {
    return value as PricingTaxBase;
  }
  return "preTaxSubtotal";
};

const getTaxBaseAmount = (base: PricingTaxBase, input: {
  costSubtotal: number;
  sellingSubtotal: number;
  preTaxSubtotal: number;
}) => {
  if (base === "costSubtotal") {
    return input.costSubtotal;
  }
  if (base === "sellingSubtotal") {
    return input.sellingSubtotal;
  }
  return input.preTaxSubtotal;
};

const taxBaseLabel = (base: PricingTaxBase) => {
  if (base === "costSubtotal") return "cost subtotal";
  if (base === "sellingSubtotal") return "selling subtotal before project adjustments";
  return "pre-tax subtotal";
};

export const createDefaultPricingSettings = (): PricingSettings => ({
  pstEnabled: false,
  pstRate: 0,
  pstAppliesTo: "preTaxSubtotal",
  gstEnabled: false,
  gstRate: 0,
  gstAppliesTo: "preTaxSubtotal",
  adjustmentPercentBase: "sellingSubtotal",
});

export const createDefaultPricingAdjustment = (): PricingAdjustment => ({
  id: makeId(),
  name: "Custom adjustment",
  type: "custom",
  amountType: "fixed",
  value: 0,
  notes: "",
  enabled: true,
});

export const normalizePricingSettings = (raw: unknown): PricingSettings => {
  if (!raw || typeof raw !== "object") {
    return createDefaultPricingSettings();
  }

  const source = raw as Record<string, unknown>;
  return {
    pstEnabled: Boolean(source.pstEnabled),
    pstRate: nonNegative(source.pstRate),
    pstAppliesTo: validTaxBase(source.pstAppliesTo),
    gstEnabled: Boolean(source.gstEnabled),
    gstRate: nonNegative(source.gstRate),
    gstAppliesTo: validTaxBase(source.gstAppliesTo),
    adjustmentPercentBase: source.adjustmentPercentBase === "costSubtotal" ? "costSubtotal" : "sellingSubtotal",
  };
};

export const normalizePricingAdjustment = (raw: unknown): PricingAdjustment | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  return {
    id: safeText(source.id, 120) || makeId(),
    name: safeText(source.name, 200) || "Custom adjustment",
    type: validAdjustmentType(source.type),
    amountType: validAdjustmentAmountType(source.amountType),
    value: nonNegative(source.value),
    notes: safeText(source.notes, 2000),
    enabled: source.enabled !== false,
  };
};

export const normalizePricingAdjustments = (raw: unknown): PricingAdjustment[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map(normalizePricingAdjustment)
    .filter((item): item is PricingAdjustment => Boolean(item));
};

export const normalizePricingSummary = (raw: unknown): PricingSummary => {
  const defaults = buildProjectPricingSummary({
    assemblies: [],
    takeoffItems: [],
    pricingSettings: createDefaultPricingSettings(),
    pricingAdjustments: [],
  });

  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const source = raw as Record<string, unknown>;
  const normalizedAdjustments = Array.isArray(source.projectAdjustments)
    ? source.projectAdjustments.map((entry) => {
        const adjustment = normalizePricingAdjustment(entry);
        if (!adjustment) {
          return null;
        }
        const item = entry as Record<string, unknown>;
        return {
          ...adjustment,
          baseAmount: roundMoney(nonNegative(item.baseAmount)),
          amount: roundMoney(numberFromUnknown(item.amount)),
        };
      }).filter((item): item is AppliedPricingAdjustment => Boolean(item))
    : [];

  const normalizedIncomplete = Array.isArray(source.incompleteAssemblies)
    ? source.incompleteAssemblies.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const item = entry as Record<string, unknown>;
        const reasons = Array.isArray(item.reasons)
          ? item.reasons.map((reason) => safeText(reason, 240)).filter(Boolean)
          : [];
        return {
          assemblyId: safeText(item.assemblyId, 120),
          assemblyName: safeText(item.assemblyName, 200) || "Unnamed assembly",
          reasons,
        };
      }).filter((item): item is PricingIncompleteAssembly => item !== null && item.assemblyId.length > 0)
    : [];

  return {
    labourSubtotal: roundMoney(nonNegative(source.labourSubtotal)),
    materialSubtotal: roundMoney(nonNegative(source.materialSubtotal)),
    equipmentSubtotal: roundMoney(nonNegative(source.equipmentSubtotal)),
    subcontractSubtotal: roundMoney(nonNegative(source.subcontractSubtotal)),
    costSubtotal: roundMoney(nonNegative(source.costSubtotal)),
    assemblyMarkup: roundMoney(nonNegative(source.assemblyMarkup)),
    sellingSubtotal: roundMoney(nonNegative(source.sellingSubtotal)),
    projectAdjustments: normalizedAdjustments,
    projectAdjustmentsTotal: roundMoney(numberFromUnknown(source.projectAdjustmentsTotal)),
    preTaxSubtotal: roundMoney(nonNegative(source.preTaxSubtotal)),
    pst: roundMoney(nonNegative(source.pst)),
    gst: roundMoney(nonNegative(source.gst)),
    finalProjectTotal: roundMoney(nonNegative(source.finalProjectTotal)),
    taxExplanations: {
      pst: safeText((source.taxExplanations as Record<string, unknown> | undefined)?.pst, 240) || defaults.taxExplanations.pst,
      gst: safeText((source.taxExplanations as Record<string, unknown> | undefined)?.gst, 240) || defaults.taxExplanations.gst,
    },
    incompleteAssemblies: normalizedIncomplete,
    hasIncompletePricing: Boolean(source.hasIncompletePricing),
  };
};

export const duplicatePricingAdjustment = (adjustment: PricingAdjustment): PricingAdjustment => {
  return {
    ...adjustment,
    id: makeId(),
    name: `${adjustment.name} (Copy)`,
  };
};

const summarizeAssemblyCompleteness = (
  assemblies: ProjectAssemblyRecord[],
  takeoffItems: TakeoffItem[],
): PricingIncompleteAssembly[] => {
  const takeoffItemIds = new Set(takeoffItems.map((item) => item.id));

  return assemblies
    .map((assembly) => {
      const totals = calculateAssemblyTotals(assembly);
      const reasons: string[] = [];

      if (assembly.quantity <= 0) {
        reasons.push("Quantity is zero.");
      }

      if (
        totals.labourSubtotal <= 0 &&
        totals.materialSubtotal <= 0 &&
        totals.equipmentSubtotal <= 0 &&
        totals.subcontractSubtotal <= 0
      ) {
        reasons.push("No labour, material, equipment, or subcontract cost entered.");
      }

      if (assembly.takeoffControl && !takeoffItemIds.has(assembly.takeoffControl.takeoffItemId)) {
        reasons.push("Takeoff link is missing or no longer available.");
      }

      if (reasons.length === 0) {
        return null;
      }

      return {
        assemblyId: assembly.id,
        assemblyName: assembly.name || "Unnamed assembly",
        reasons,
      };
    })
    .filter((item): item is PricingIncompleteAssembly => Boolean(item));
};

export const buildProjectPricingSummary = (input: {
  assemblies: ProjectAssemblyRecord[];
  takeoffItems: TakeoffItem[];
  pricingSettings: PricingSettings;
  pricingAdjustments: PricingAdjustment[];
}): PricingSummary => {
  const assemblies = Array.isArray(input.assemblies) ? input.assemblies : [];
  const takeoffItems = Array.isArray(input.takeoffItems) ? input.takeoffItems : [];
  const pricingSettings = normalizePricingSettings(input.pricingSettings);
  const pricingAdjustments = normalizePricingAdjustments(input.pricingAdjustments);

  let labourSubtotal = 0;
  let materialSubtotal = 0;
  let equipmentSubtotal = 0;
  let subcontractSubtotal = 0;
  let assemblyMarkup = 0;
  let sellingSubtotal = 0;

  for (const assembly of assemblies) {
    const totals = calculateAssemblyTotals(assembly);
    labourSubtotal += totals.labourSubtotal;
    materialSubtotal += totals.materialSubtotal;
    equipmentSubtotal += totals.equipmentSubtotal;
    subcontractSubtotal += totals.subcontractSubtotal;
    assemblyMarkup += totals.markupAmount;
    sellingSubtotal += totals.preTaxTotal;
  }

  labourSubtotal = roundMoney(labourSubtotal);
  materialSubtotal = roundMoney(materialSubtotal);
  equipmentSubtotal = roundMoney(equipmentSubtotal);
  subcontractSubtotal = roundMoney(subcontractSubtotal);
  const costSubtotal = roundMoney(labourSubtotal + materialSubtotal + equipmentSubtotal + subcontractSubtotal);
  assemblyMarkup = roundMoney(assemblyMarkup);
  sellingSubtotal = roundMoney(sellingSubtotal);

  const adjustmentBase = pricingSettings.adjustmentPercentBase === "costSubtotal" ? costSubtotal : sellingSubtotal;
  const appliedAdjustments: AppliedPricingAdjustment[] = [];

  for (const adjustment of pricingAdjustments) {
    const value = nonNegative(adjustment.value);
    const unsignedAmount = adjustment.amountType === "percent"
      ? roundMoney(adjustmentBase * (value / 100))
      : roundMoney(value);

    const sign = adjustment.type === "discount" ? -1 : 1;
    const amount = adjustment.enabled ? roundMoney(unsignedAmount * sign) : 0;

    appliedAdjustments.push({
      ...adjustment,
      value,
      baseAmount: adjustment.amountType === "percent" ? adjustmentBase : 0,
      amount,
    });
  }

  const projectAdjustmentsTotal = roundMoney(appliedAdjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0));
  const preTaxSubtotal = roundMoney(Math.max(0, sellingSubtotal + projectAdjustmentsTotal));

  const pstBase = roundMoney(getTaxBaseAmount(pricingSettings.pstAppliesTo, {
    costSubtotal,
    sellingSubtotal,
    preTaxSubtotal,
  }));
  const gstBase = roundMoney(getTaxBaseAmount(pricingSettings.gstAppliesTo, {
    costSubtotal,
    sellingSubtotal,
    preTaxSubtotal,
  }));

  const pst = pricingSettings.pstEnabled
    ? roundMoney(pstBase * (nonNegative(pricingSettings.pstRate) / 100))
    : 0;
  const gst = pricingSettings.gstEnabled
    ? roundMoney(gstBase * (nonNegative(pricingSettings.gstRate) / 100))
    : 0;

  const finalProjectTotal = roundMoney(preTaxSubtotal + pst + gst);

  const incompleteAssemblies = summarizeAssemblyCompleteness(assemblies, takeoffItems);

  return {
    labourSubtotal,
    materialSubtotal,
    equipmentSubtotal,
    subcontractSubtotal,
    costSubtotal,
    assemblyMarkup,
    sellingSubtotal,
    projectAdjustments: appliedAdjustments,
    projectAdjustmentsTotal,
    preTaxSubtotal,
    pst,
    gst,
    finalProjectTotal,
    taxExplanations: {
      pst: pricingSettings.pstEnabled
        ? `PST at ${pricingSettings.pstRate}% is applied to ${taxBaseLabel(pricingSettings.pstAppliesTo)}.`
        : "PST is disabled.",
      gst: pricingSettings.gstEnabled
        ? `GST at ${pricingSettings.gstRate}% is applied to ${taxBaseLabel(pricingSettings.gstAppliesTo)}.`
        : "GST is disabled.",
    },
    incompleteAssemblies,
    hasIncompletePricing: incompleteAssemblies.length > 0,
  };
};
