"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ASSEMBLY_CATEGORIES,
  ASSEMBLY_UNITS,
  applyAssemblyCalculations,
  calculateAssemblyTotals,
  cloneTemplate,
  createEmptyAssembly,
  createEmptyLineItem,
  formatCurrency,
  normalizeLibraryTemplates,
  type AssemblyLibraryTemplate,
  type AssemblyLineItem,
  type AssemblyUnit,
} from "../../lib/assembly-estimating";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ViewMode = "active" | "archived";
type LineItemBucket = "labourItems" | "materialItems" | "equipmentItems" | "subcontractItems";

const subtotalLabel: Record<LineItemBucket, string> = {
  labourItems: "Labour",
  materialItems: "Materials",
  equipmentItems: "Equipment",
  subcontractItems: "Subcontract",
};

const bucketOrder: LineItemBucket[] = ["labourItems", "materialItems", "equipmentItems", "subcontractItems"];

const TAX_LABELS: Record<AssemblyLibraryTemplate["taxHandling"], string> = {
  exclusive: "GST/PST added externally",
  included: "Tax included in rates",
  exempt: "Tax exempt",
};

const parseNumberInput = (raw: string, fallback = 0) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
};

export default function AssemblyLibraryClient() {
  const [templates, setTemplates] = useState<AssemblyLibraryTemplate[]>([]);
  const [archivedTemplates, setArchivedTemplates] = useState<AssemblyLibraryTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [draft, setDraft] = useState<AssemblyLibraryTemplate | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorTemplateId, setEditorTemplateId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);

  const visibleTemplates = useMemo(() => {
    const source = viewMode === "active" ? templates : archivedTemplates;
    const normalizedSearch = search.trim().toLowerCase();

    return source.filter((template) => {
      if (categoryFilter !== "All" && template.category !== categoryFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [template.name, template.description, template.notes, template.category]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [archivedTemplates, categoryFilter, search, templates, viewMode]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>(["All"]);
    for (const template of [...templates, ...archivedTemplates]) {
      categories.add(template.category);
    }
    return Array.from(categories.values());
  }, [archivedTemplates, templates]);

  const loadLibrary = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/assembly-library", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json() as {
        success?: boolean;
        message?: string;
        library?: {
          templates?: unknown[];
          archivedTemplates?: unknown[];
        };
      };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load Assembly Library.");
      }

      setTemplates(normalizeLibraryTemplates(data.library?.templates ?? []));
      setArchivedTemplates(normalizeLibraryTemplates(data.library?.archivedTemplates ?? []));
    } catch (requestError) {
      const loadError = requestError instanceof Error ? requestError.message : "Could not load Assembly Library.";
      setError(loadError);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

  useEffect(() => {
    const closeMenuOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current) {
        return;
      }
      const target = event.target as Node | null;
      if (target && !menuRef.current.contains(target)) {
        setOpenMenuId(null);
      }
    };

    window.addEventListener("mousedown", closeMenuOnOutsideClick);
    window.addEventListener("touchstart", closeMenuOnOutsideClick);
    return () => {
      window.removeEventListener("mousedown", closeMenuOnOutsideClick);
      window.removeEventListener("touchstart", closeMenuOnOutsideClick);
    };
  }, []);

  const setStatusSaved = () => {
    setSaveStatus("saved");
    window.setTimeout(() => {
      setSaveStatus("idle");
    }, 1200);
  };

  const openCreateDialog = () => {
    const blank = createEmptyAssembly();
    setDraft({
      ...blank,
      archivedAt: null,
    });
    setEditorMode("create");
    setEditorTemplateId(null);
    setValidationError(null);
  };

  const openEditDialog = (template: AssemblyLibraryTemplate) => {
    setDraft(applyAssemblyCalculations(template) as AssemblyLibraryTemplate);
    setEditorMode("edit");
    setEditorTemplateId(template.id);
    setValidationError(null);
  };

  const closeEditor = () => {
    setDraft(null);
    setEditorMode(null);
    setEditorTemplateId(null);
    setValidationError(null);
  };

  const updateDraftField = <K extends keyof AssemblyLibraryTemplate>(field: K, value: AssemblyLibraryTemplate[K]) => {
    setDraft((current) => {
      if (!current) return current;
      return applyAssemblyCalculations({
        ...current,
        [field]: value,
        updatedAt: new Date().toISOString(),
      }) as AssemblyLibraryTemplate;
    });
  };

  const addLineItem = (bucket: LineItemBucket) => {
    setDraft((current) => {
      if (!current) return current;
      return applyAssemblyCalculations({
        ...current,
        [bucket]: [...current[bucket], createEmptyLineItem()],
      }) as AssemblyLibraryTemplate;
    });
  };

  const updateLineItem = (bucket: LineItemBucket, lineId: string, patch: Partial<AssemblyLineItem>) => {
    setDraft((current) => {
      if (!current) return current;
      return applyAssemblyCalculations({
        ...current,
        [bucket]: current[bucket].map((item) => item.id === lineId ? { ...item, ...patch } : item),
      }) as AssemblyLibraryTemplate;
    });
  };

  const removeLineItem = (bucket: LineItemBucket, lineId: string) => {
    setDraft((current) => {
      if (!current) return current;
      return applyAssemblyCalculations({
        ...current,
        [bucket]: current[bucket].filter((item) => item.id !== lineId),
      }) as AssemblyLibraryTemplate;
    });
  };

  const submitTemplate = async () => {
    if (!draft) {
      return;
    }

    if (!draft.name.trim()) {
      setValidationError("Template name is required.");
      return;
    }

    setSaveStatus("saving");
    setError(null);

    try {
      const payload = {
        ...applyAssemblyCalculations({
          ...draft,
          name: draft.name.trim(),
          archivedAt: draft.archivedAt,
          updatedAt: new Date().toISOString(),
        }),
      };

      const response = await fetch("/api/assembly-library", {
        method: editorMode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editorMode === "create"
            ? { action: "create", template: payload }
            : { action: "edit", templateId: editorTemplateId, template: payload },
        ),
      });

      const data = await response.json() as {
        success?: boolean;
        message?: string;
        library?: { templates?: unknown[]; archivedTemplates?: unknown[] };
      };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not save template.");
      }

      setTemplates(normalizeLibraryTemplates(data.library?.templates ?? []));
      setArchivedTemplates(normalizeLibraryTemplates(data.library?.archivedTemplates ?? []));
      setMessage(editorMode === "create" ? "Template created." : "Template updated.");
      setStatusSaved();
      closeEditor();
    } catch (submitError) {
      const text = submitError instanceof Error ? submitError.message : "Could not save template.";
      setError(text);
      setSaveStatus("error");
    }
  };

  const executeTemplateAction = async (requestBody: Record<string, unknown>, successMessage: string) => {
    setSaveStatus("saving");
    setError(null);

    try {
      const method = requestBody.action === "duplicate" ? "POST" : requestBody.action === "delete" ? "DELETE" : "PATCH";
      const response = await fetch("/api/assembly-library", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json() as {
        success?: boolean;
        message?: string;
        library?: { templates?: unknown[]; archivedTemplates?: unknown[] };
      };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not update template.");
      }

      setTemplates(normalizeLibraryTemplates(data.library?.templates ?? []));
      setArchivedTemplates(normalizeLibraryTemplates(data.library?.archivedTemplates ?? []));
      setMessage(successMessage);
      setStatusSaved();
      setOpenMenuId(null);
    } catch (requestError) {
      const text = requestError instanceof Error ? requestError.message : "Could not update template.";
      setError(text);
      setSaveStatus("error");
    }
  };

  const statusText = saveStatus === "saving"
    ? "Saving..."
    : saveStatus === "saved"
      ? "Saved"
      : saveStatus === "error"
        ? "Could not save"
        : "Ready";

  return (
    <main style={{ minHeight: "100vh", background: "#f4efe5", color: "#2f2a24", padding: "40px 24px", fontFamily: "Arial, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 1040, margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-block", marginBottom: 16, color: "#766b5d", textDecoration: "none" }}>← Back to Workspace</Link>

        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, color: "#766b5d", fontSize: 14 }}>Company Reusable Templates</p>
            <h1 style={{ margin: "8px 0 0", fontSize: "clamp(28px, 5vw, 36px)", fontWeight: 700 }}>Assembly Library</h1>
            <p style={{ margin: "6px 0 0", color: saveStatus === "error" ? "#a1260d" : "#766b5d", fontSize: 13 }}>{statusText}</p>
          </div>

          <button onClick={openCreateDialog} style={{ minHeight: 44, border: "none", borderRadius: 8, background: "#594f43", color: "#fff", padding: "10px 14px", cursor: "pointer" }}>
            Create template
          </button>
        </header>

        <section style={{ background: "#fffaf2", border: "1px solid #d8cdbc", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(220px, 1fr) minmax(180px, 220px)" }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" style={{ minHeight: 44, border: "1px solid #d8cdbc", borderRadius: 8, padding: "10px 12px" }} />
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} style={{ minHeight: 44, border: "1px solid #d8cdbc", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setViewMode("active")} style={{ minHeight: 40, borderRadius: 999, border: "1px solid #d8cdbc", background: viewMode === "active" ? "#594f43" : "#fff", color: viewMode === "active" ? "#fff" : "#2f2a24", padding: "8px 12px", cursor: "pointer" }}>
              Active ({templates.length})
            </button>
            <button onClick={() => setViewMode("archived")} style={{ minHeight: 40, borderRadius: 999, border: "1px solid #d8cdbc", background: viewMode === "archived" ? "#594f43" : "#fff", color: viewMode === "archived" ? "#fff" : "#2f2a24", padding: "8px 12px", cursor: "pointer" }}>
              Archived ({archivedTemplates.length})
            </button>
          </div>

          {error && (
            <div style={{ marginTop: 10, border: "1px solid #e4b6ac", background: "#fff0ed", color: "#7d2613", borderRadius: 8, padding: "10px 12px" }}>
              {error}
            </div>
          )}

          {message && (
            <div style={{ marginTop: 10, border: "1px solid #c7dec8", background: "#eef9ef", color: "#2f6f42", borderRadius: 8, padding: "10px 12px" }}>
              {message}
            </div>
          )}

          {isLoading ? (
            <div style={{ marginTop: 12, border: "1px dashed #d8cdbc", borderRadius: 8, padding: 12, color: "#766b5d" }}>Loading Assembly Library...</div>
          ) : visibleTemplates.length === 0 ? (
            <div style={{ marginTop: 12, border: "1px dashed #d8cdbc", borderRadius: 8, padding: 12, color: "#766b5d" }}>
              {viewMode === "active"
                ? "No templates yet. Create a reusable template here, or save an assembly to the library from a project."
                : "No archived templates."}
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {visibleTemplates.map((template) => {
                const expanded = expandedIds[template.id] === true;
                const totals = calculateAssemblyTotals(template);

                return (
                  <div key={template.id} style={{ border: "1px solid #e6dac8", borderRadius: 10, background: "#fff", padding: 10 }}>
                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "flex-start" }}>
                      <button
                        onClick={() => setExpandedIds((current) => ({ ...current, [template.id]: !current[template.id] }))}
                        style={{ border: "none", background: "transparent", textAlign: "left", cursor: "pointer", padding: 0, flex: 1, minHeight: 44 }}
                      >
                        <div style={{ fontWeight: 700 }}>{template.name}</div>
                        <div style={{ marginTop: 4, color: "#766b5d", fontSize: 13 }}>{template.category} • Library template • {template.quantity} {template.unit}</div>
                      </button>

                      <div style={{ position: "relative" }}>
                        <button onClick={() => setOpenMenuId((current) => current === template.id ? null : template.id)} style={{ width: 44, height: 44, border: "1px solid #d8cdbc", background: "#fffaf2", borderRadius: 8, cursor: "pointer" }}>⋯</button>

                        {openMenuId === template.id && (
                          <div ref={menuRef} style={{ position: "absolute", right: 0, top: 46, zIndex: 20, minWidth: 170, border: "1px solid #d8cdbc", borderRadius: 10, background: "#fffaf2", boxShadow: "0 10px 20px rgba(47,42,36,0.12)", padding: 6, display: "grid", gap: 4 }}>
                            {viewMode === "active" ? (
                              <>
                                <button onClick={() => { openEditDialog(template); setOpenMenuId(null); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Edit</button>
                                <button onClick={() => { const duplicate = cloneTemplate(template); void executeTemplateAction({ action: "create", template: duplicate }, "Template duplicated."); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Duplicate</button>
                                <button onClick={() => { void executeTemplateAction({ action: "archive", templateId: template.id }, "Template archived."); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Archive</button>
                              </>
                            ) : (
                              <button onClick={() => { void executeTemplateAction({ action: "restore", templateId: template.id }, "Template restored."); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Restore</button>
                            )}
                            <button
                              onClick={() => {
                                if (!window.confirm(`Delete "${template.name}" permanently from the library?`)) {
                                  return;
                                }
                                void executeTemplateAction({ action: "delete", templateId: template.id }, "Template deleted.");
                              }}
                              style={{ textAlign: "left", border: "none", background: "transparent", color: "#a1260d", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: 8, display: "grid", gap: 4, color: "#4b453d", fontSize: 13 }}>
                      <div>Labour subtotal: {formatCurrency(totals.labourSubtotal)}</div>
                      <div>Material subtotal: {formatCurrency(totals.materialSubtotal)}</div>
                      <div>Markup: {formatCurrency(totals.markupAmount)}</div>
                      <div style={{ fontWeight: 700 }}>Template total: {formatCurrency(totals.total)}</div>
                    </div>

                    {expanded && (
                      <div style={{ marginTop: 10, borderTop: "1px solid #efe4d5", paddingTop: 10, display: "grid", gap: 6, color: "#5f564c", fontSize: 13 }}>
                        {template.description && <div><strong>Description:</strong> {template.description}</div>}
                        <div><strong>Tax handling:</strong> {TAX_LABELS[template.taxHandling]}</div>
                        <div><strong>Waste:</strong> {template.wastePercent}%</div>
                        <div><strong>Created:</strong> {new Date(template.createdAt).toLocaleString()}</div>
                        <div><strong>Updated:</strong> {new Date(template.updatedAt).toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {draft && editorMode && (
        <div onClick={closeEditor} style={{ position: "fixed", inset: 0, background: "rgba(32, 25, 19, 0.35)", display: "grid", placeItems: "center", zIndex: 70, padding: 14 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "min(880px, 100%)", maxHeight: "90vh", overflow: "auto", background: "#fffaf2", border: "1px solid #d8cdbc", borderRadius: 14, padding: 16, boxShadow: "0 18px 34px rgba(47,42,36,0.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{editorMode === "create" ? "Create template" : "Edit template"}</h3>
              <button onClick={closeEditor} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", background: "#fff", padding: "10px 12px", cursor: "pointer" }}>Done</button>
            </div>

            {validationError && (
              <div style={{ marginTop: 10, border: "1px solid #e4b6ac", background: "#fff0ed", color: "#7d2613", borderRadius: 8, padding: "10px 12px" }}>
                {validationError}
              </div>
            )}

            <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Name</span>
                <input value={draft.name} onChange={(event) => updateDraftField("name", event.target.value)} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Category</span>
                <select value={draft.category} onChange={(event) => updateDraftField("category", event.target.value as AssemblyLibraryTemplate["category"])} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}>
                  {ASSEMBLY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Quantity</span>
                <input value={draft.quantity} onChange={(event) => updateDraftField("quantity", parseNumberInput(event.target.value, 1))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Unit</span>
                <select value={draft.unit} onChange={(event) => updateDraftField("unit", event.target.value as AssemblyUnit)} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}>
                  {ASSEMBLY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Waste %</span>
                <input value={draft.wastePercent} onChange={(event) => updateDraftField("wastePercent", parseNumberInput(event.target.value))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Markup %</span>
                <input value={draft.markupPercent} onChange={(event) => updateDraftField("markupPercent", parseNumberInput(event.target.value))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Tax handling</span>
                <select value={draft.taxHandling} onChange={(event) => updateDraftField("taxHandling", event.target.value as AssemblyLibraryTemplate["taxHandling"])} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}>
                  <option value="exclusive">GST/PST added externally</option>
                  <option value="included">Tax included in rates</option>
                  <option value="exempt">Tax exempt</option>
                </select>
              </label>
            </div>

            <label style={{ marginTop: 12, display: "grid", gap: 6 }}>
              <span>Description</span>
              <textarea value={draft.description} onChange={(event) => updateDraftField("description", event.target.value)} style={{ minHeight: 74, borderRadius: 8, border: "1px solid #d8cdbc", padding: 10 }} />
            </label>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {bucketOrder.map((bucket) => {
                const items = draft[bucket];
                const subtotal = items.reduce((sum, item) => sum + item.total, 0);

                return (
                  <div key={bucket} style={{ border: "1px solid #e6dac8", borderRadius: 10, background: "#fff", padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <strong>{subtotalLabel[bucket]} items</strong>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: "#766b5d", fontSize: 13 }}>Subtotal: {formatCurrency(subtotal)}</span>
                        <button onClick={() => addLineItem(bucket)} style={{ minHeight: 44, border: "1px solid #d8cdbc", background: "#fffaf2", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}>Add item</button>
                      </div>
                    </div>

                    {items.length === 0 ? (
                      <div style={{ marginTop: 8, border: "1px dashed #e7ddcf", borderRadius: 8, padding: 10, color: "#7d7367" }}>No items yet.</div>
                    ) : (
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {items.map((item) => (
                          <div key={item.id} style={{ border: "1px solid #efe4d6", borderRadius: 8, padding: 10, background: "#fffaf4" }}>
                            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                              <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
                                <span>Description</span>
                                <input value={item.description} onChange={(event) => updateLineItem(bucket, item.id, { description: event.target.value })} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
                              </label>
                              <label style={{ display: "grid", gap: 4 }}>
                                <span>Qty</span>
                                <input value={item.quantity} onChange={(event) => updateLineItem(bucket, item.id, { quantity: parseNumberInput(event.target.value, 0) })} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
                              </label>
                              <label style={{ display: "grid", gap: 4 }}>
                                <span>Unit</span>
                                <select value={item.unit} onChange={(event) => updateLineItem(bucket, item.id, { unit: event.target.value as AssemblyUnit })} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}>
                                  {ASSEMBLY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                                </select>
                              </label>
                              <label style={{ display: "grid", gap: 4 }}>
                                <span>Unit cost</span>
                                <input value={item.unitCost} onChange={(event) => updateLineItem(bucket, item.id, { unitCost: parseNumberInput(event.target.value, 0) })} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
                              </label>
                              <label style={{ display: "grid", gap: 4 }}>
                                <span>Total</span>
                                <input value={formatCurrency(item.total)} readOnly style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#f8f1e6" }} />
                              </label>
                              <label style={{ display: "grid", gap: 4 }}>
                                <span>Source</span>
                                <input value={item.source} onChange={(event) => updateLineItem(bucket, item.id, { source: event.target.value })} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
                              </label>
                            </div>
                            <label style={{ marginTop: 8, display: "grid", gap: 4 }}>
                              <span>Notes</span>
                              <textarea value={item.notes} onChange={(event) => updateLineItem(bucket, item.id, { notes: event.target.value })} style={{ minHeight: 64, borderRadius: 8, border: "1px solid #d8cdbc", padding: 10 }} />
                            </label>
                            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                              <button onClick={() => removeLineItem(bucket, item.id)} style={{ minHeight: 44, border: "1px solid #d8cdbc", background: "#fff", color: "#a1260d", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}>Remove item</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <label style={{ marginTop: 12, display: "grid", gap: 6 }}>
              <span>Template notes</span>
              <textarea value={draft.notes} onChange={(event) => updateDraftField("notes", event.target.value)} style={{ minHeight: 80, borderRadius: 8, border: "1px solid #d8cdbc", padding: 10 }} />
            </label>

            <div style={{ marginTop: 12, border: "1px solid #e8dccc", borderRadius: 10, background: "#fff", padding: 10, display: "grid", gap: 6 }}>
              {(() => {
                const totals = calculateAssemblyTotals(draft);
                return (
                  <>
                    <div>Labour subtotal: {formatCurrency(totals.labourSubtotal)}</div>
                    <div>Material subtotal: {formatCurrency(totals.materialSubtotal)}</div>
                    <div>Equipment subtotal: {formatCurrency(totals.equipmentSubtotal)}</div>
                    <div>Subcontract subtotal: {formatCurrency(totals.subcontractSubtotal)}</div>
                    <div>Waste amount: {formatCurrency(totals.wasteAmount)}</div>
                    <div>Markup: {formatCurrency(totals.markupAmount)}</div>
                    <div style={{ fontWeight: 700 }}>Pre-tax total: {formatCurrency(totals.preTaxTotal)}</div>
                  </>
                );
              })()}
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button onClick={closeEditor} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", background: "#fff", padding: "10px 12px", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { void submitTemplate(); }} style={{ minHeight: 44, borderRadius: 8, border: "none", background: "#594f43", color: "#fff", padding: "10px 14px", cursor: "pointer" }}>
                {editorMode === "create" ? "Create template" : "Save template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
