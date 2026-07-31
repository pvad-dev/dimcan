"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ASSEMBLY_CATEGORIES,
  ASSEMBLY_UNITS,
  applyAssemblyCalculations,
  calculateAssemblyTotals,
  createProjectAssemblyFromTemplate,
  createEmptyAssembly,
  createEmptyLineItem,
  formatCurrency,
  isMeaningfullyDifferentAssembly,
  normalizeLibraryTemplates,
  type AssemblyLibraryTemplate,
  type AssemblyLineItem,
  type AssemblyUnit,
  type ProjectAssemblyRecord,
} from "../../../lib/assembly-estimating";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type AssembliesPanelProps = {
  assemblies: ProjectAssemblyRecord[];
  isLoading: boolean;
  saveStatus: SaveStatus;
  onCreateAssembly: (assembly: ProjectAssemblyRecord) => void;
  onImportAssembliesFromLibrary: (assemblies: ProjectAssemblyRecord[], sourceTemplates: AssemblyLibraryTemplate[]) => void;
  onDeleteAssembly: (assemblyId: string) => void;
  onDuplicateAssembly: (assemblyId: string) => void;
  onAutosaveAssemblyEdit: (assembly: ProjectAssemblyRecord, logActivity: boolean) => void;
};

type LineItemBucket = "labourItems" | "materialItems" | "equipmentItems" | "subcontractItems";

type EditorMode = "create" | "edit";

const TAX_LABELS: Record<ProjectAssemblyRecord["taxHandling"], string> = {
  exclusive: "GST/PST added externally",
  included: "Tax included in rates",
  exempt: "Tax exempt",
};

const subtotalLabel: Record<LineItemBucket, string> = {
  labourItems: "Labour",
  materialItems: "Materials",
  equipmentItems: "Equipment",
  subcontractItems: "Subcontract",
};

const bucketOrder: LineItemBucket[] = ["labourItems", "materialItems", "equipmentItems", "subcontractItems"];

const parseNumberInput = (raw: string, fallback = 0) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
};

export default function AssembliesPanel({
  assemblies,
  isLoading,
  saveStatus,
  onCreateAssembly,
  onImportAssembliesFromLibrary,
  onDeleteAssembly,
  onDuplicateAssembly,
  onAutosaveAssemblyEdit,
}: AssembliesPanelProps) {
  const [expandedAssemblies, setExpandedAssemblies] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editorAssemblyId, setEditorAssemblyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectAssemblyRecord | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [hasLoggedEditForSession, setHasLoggedEditForSession] = useState(false);
  const [libraryTemplates, setLibraryTemplates] = useState<AssemblyLibraryTemplate[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const [isLibraryImportOpen, setIsLibraryImportOpen] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Record<string, boolean>>({});
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState("All");

  const menuRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const editingAssembly = useMemo(
    () => assemblies.find((assembly) => assembly.id === editorAssemblyId) ?? null,
    [assemblies, editorAssemblyId],
  );
  const isTakeoffControlled = editorMode === "edit" && Boolean(editingAssembly?.takeoffControl);

  const filteredLibraryTemplates = useMemo(() => {
    const normalizedSearch = librarySearch.trim().toLowerCase();
    return libraryTemplates.filter((template) => {
      if (libraryCategoryFilter !== "All" && template.category !== libraryCategoryFilter) {
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
  }, [libraryCategoryFilter, librarySearch, libraryTemplates]);

  const libraryCategories = useMemo(() => {
    const categories = new Set<string>(["All"]);
    for (const template of libraryTemplates) {
      categories.add(template.category);
    }
    return Array.from(categories.values());
  }, [libraryTemplates]);

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

  useEffect(() => {
    if (!draft || editorMode !== "edit" || !editingAssembly) {
      return;
    }

    const next = applyAssemblyCalculations({
      ...draft,
      updatedAt: new Date().toISOString(),
    });

    if (!isMeaningfullyDifferentAssembly(editingAssembly, next)) {
      return;
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      onAutosaveAssemblyEdit(next, !hasLoggedEditForSession);
      setHasLoggedEditForSession(true);
      autosaveTimerRef.current = null;
    }, 450) as unknown as number;

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [draft, editorMode, editingAssembly, hasLoggedEditForSession, onAutosaveAssemblyEdit]);

  const loadLibraryTemplates = async () => {
    setLibraryLoading(true);
    setLibraryError(null);

    try {
      const response = await fetch("/api/assembly-library?includeArchived=false", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json() as {
        success?: boolean;
        message?: string;
        library?: {
          templates?: unknown[];
        };
      };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load Assembly Library.");
      }

      setLibraryTemplates(normalizeLibraryTemplates(data.library?.templates ?? []));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load Assembly Library.";
      setLibraryError(message);
    } finally {
      setLibraryLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditorMode("create");
    setEditorAssemblyId(null);
    setDraft(createEmptyAssembly());
    setValidationError(null);
    setPanelError(null);
    setHasLoggedEditForSession(false);
  };

  const openLibraryImportDialog = () => {
    setIsLibraryImportOpen(true);
    setSelectedTemplateIds({});
    setLibrarySearch("");
    setLibraryCategoryFilter("All");
    void loadLibraryTemplates();
  };

  const openEditDialog = (assemblyId: string) => {
    const existing = assemblies.find((assembly) => assembly.id === assemblyId);
    if (!existing) {
      setPanelError("That assembly could not be found.");
      return;
    }

    setEditorMode("edit");
    setEditorAssemblyId(assemblyId);
    setDraft(applyAssemblyCalculations(existing));
    setValidationError(null);
    setPanelError(null);
    setHasLoggedEditForSession(false);
  };

  const closeDialog = () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setEditorMode(null);
    setEditorAssemblyId(null);
    setDraft(null);
    setValidationError(null);
    setHasLoggedEditForSession(false);
  };

  const updateDraftField = <K extends keyof ProjectAssemblyRecord>(field: K, value: ProjectAssemblyRecord[K]) => {
    setDraft((current) => {
      if (!current) return current;
      return applyAssemblyCalculations({
        ...current,
        [field]: value,
        updatedAt: new Date().toISOString(),
      });
    });
  };

  const addLineItem = (bucket: LineItemBucket) => {
    setDraft((current) => {
      if (!current) return current;
      const nextItems = [...current[bucket], createEmptyLineItem()];
      return applyAssemblyCalculations({
        ...current,
        [bucket]: nextItems,
      });
    });
  };

  const removeLineItem = (bucket: LineItemBucket, lineId: string) => {
    setDraft((current) => {
      if (!current) return current;
      return applyAssemblyCalculations({
        ...current,
        [bucket]: current[bucket].filter((item) => item.id !== lineId),
      });
    });
  };

  const updateLineItem = (bucket: LineItemBucket, lineId: string, patch: Partial<AssemblyLineItem>) => {
    setDraft((current) => {
      if (!current) return current;
      const nextItems = current[bucket].map((item) => item.id === lineId ? { ...item, ...patch } : item);
      return applyAssemblyCalculations({
        ...current,
        [bucket]: nextItems,
      });
    });
  };

  const saveCreateAssembly = () => {
    if (!draft) {
      return;
    }

    if (!draft.name.trim()) {
      setValidationError("Assembly name is required.");
      return;
    }

    const normalized = applyAssemblyCalculations({
      ...draft,
      name: draft.name.trim(),
      updatedAt: new Date().toISOString(),
      createdAt: draft.createdAt || new Date().toISOString(),
    });

    onCreateAssembly(normalized);
    closeDialog();
  };

  const importSelectedTemplates = () => {
    const selected = filteredLibraryTemplates.filter((template) => selectedTemplateIds[template.id]);
    if (selected.length === 0) {
      setLibraryError("Select at least one template to import.");
      return;
    }

    const importedAssemblies = selected.map((template) => createProjectAssemblyFromTemplate(template));
    onImportAssembliesFromLibrary(importedAssemblies, selected);
    setIsLibraryImportOpen(false);
    setLibraryMessage(`${selected.length} template${selected.length === 1 ? "" : "s"} imported to this project.`);
  };

  const saveAssemblyToLibrary = async (assembly: ProjectAssemblyRecord) => {
    setLibraryMessage(null);
    setPanelError(null);

    try {
      const currentResponse = await fetch("/api/assembly-library?includeArchived=false", {
        method: "GET",
        cache: "no-store",
      });

      const currentData = await currentResponse.json() as {
        success?: boolean;
        message?: string;
        library?: { templates?: unknown[] };
      };

      if (!currentResponse.ok || !currentData.success) {
        throw new Error(currentData.message || "Could not load Assembly Library.");
      }

      const templates = normalizeLibraryTemplates(currentData.library?.templates ?? []);
      const normalizedName = assembly.name.trim().toLowerCase();
      const match = templates.find((template) => template.name.trim().toLowerCase() === normalizedName);

      let mode: "copy" | "replace" = "copy";
      let targetTemplateId: string | undefined;

      if (match) {
        const replace = window.confirm(
          `A library template named "${match.name}" already exists.\n\nSelect OK to replace it, or Cancel to create a new copy.`,
        );

        if (replace) {
          mode = "replace";
          targetTemplateId = match.id;
        }
      }

      const response = await fetch("/api/assembly-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-from-project",
          assembly,
          mode,
          targetTemplateId,
        }),
      });

      const data = await response.json() as { success?: boolean; message?: string; library?: { templates?: unknown[] } };

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not save to Assembly Library.");
      }

      setLibraryTemplates(normalizeLibraryTemplates(data.library?.templates ?? []));
      setLibraryMessage(mode === "replace" ? "Template replaced in Assembly Library." : "Assembly saved to Assembly Library.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save to Assembly Library.";
      setPanelError(message);
    }
  };

  const displayedStatus = saveStatus === "saving"
    ? "Saving..."
    : saveStatus === "saved"
      ? "Saved"
      : saveStatus === "error"
        ? "Could not save"
        : "Autosave enabled";

  return (
    <section style={{ marginBottom: 16, background: "#fffaf2", border: "1px solid #d8cdbc", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Assemblies</h2>
          <p style={{ margin: "6px 0 0", color: saveStatus === "error" ? "#a1260d" : "#766b5d", fontSize: 12 }}>{displayedStatus}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={openLibraryImportDialog}
            style={{ minHeight: 44, border: "1px solid #d8cdbc", background: "#fff", color: "#2f2a24", borderRadius: 8, padding: "10px 14px", cursor: "pointer" }}
          >
            Add from Library
          </button>
          <Link
            href="/assembly-library"
            style={{ minHeight: 44, border: "1px solid #d8cdbc", background: "#fffaf2", color: "#2f2a24", borderRadius: 8, padding: "10px 14px", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Open Library
          </Link>
          <button
            onClick={openCreateDialog}
            style={{ minHeight: 44, border: "none", background: "#594f43", color: "#fff", borderRadius: 8, padding: "10px 14px", cursor: "pointer" }}
          >
            Create assembly
          </button>
        </div>
      </div>

      <p style={{ margin: "10px 0 0", color: "#766b5d", fontSize: 13 }}>
        Assumption: waste percentage applies to materials, equipment, and subcontract totals.
      </p>

      {panelError && (
        <div style={{ marginTop: 10, border: "1px solid #e4b6ac", background: "#fff0ed", color: "#7d2613", borderRadius: 8, padding: "10px 12px" }}>
          {panelError}
        </div>
      )}
      {libraryMessage && (
        <div style={{ marginTop: 10, border: "1px solid #c7dec8", background: "#eef9ef", color: "#2f6f42", borderRadius: 8, padding: "10px 12px" }}>
          {libraryMessage}
        </div>
      )}

      {isLoading ? (
        <div style={{ marginTop: 12, border: "1px dashed #d8cdbc", borderRadius: 8, padding: 12, color: "#766b5d" }}>Loading assemblies...</div>
      ) : assemblies.length === 0 ? (
        <div style={{ marginTop: 12, border: "1px dashed #d8cdbc", borderRadius: 8, padding: 12, color: "#766b5d" }}>
          No assemblies yet. Create an assembly to estimate scope, labour, and materials.
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {assemblies.map((assembly) => {
            const totals = calculateAssemblyTotals(assembly);
            const expanded = expandedAssemblies[assembly.id] === true;

            return (
              <div key={assembly.id} style={{ background: "#fff", border: "1px solid #e6dac8", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{assembly.name}</div>
                    <div style={{ marginTop: 4, color: "#766b5d", fontSize: 13 }}>{assembly.category} • {assembly.quantity} {assembly.unit}</div>
                    <div style={{ marginTop: 4, color: "#8b7f70", fontSize: 12 }}>
                      {assembly.sourceTemplateId ? `Project assembly from Library template ${assembly.sourceTemplateId}` : "Project assembly"}
                    </div>
                    {assembly.takeoffControl && (
                      <div style={{ marginTop: 4, color: "#594f43", fontSize: 12, fontWeight: 700 }}>
                        Quantity controlled by Takeoff: {assembly.takeoffControl.takeoffItemName}
                      </div>
                    )}
                  </div>
                  <div style={{ position: "relative", display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setExpandedAssemblies((current) => current[assembly.id] ? {} : { [assembly.id]: true })}
                      style={{ minHeight: 44, border: "1px solid #d8cdbc", background: "#fffaf2", color: "#2f2a24", borderRadius: 8, padding: "10px 12px", cursor: "pointer" }}
                    >
                      {expanded ? "Collapse" : "Expand"}
                    </button>
                    <button
                      onClick={() => setOpenMenuId((current) => current === assembly.id ? null : assembly.id)}
                      style={{ width: 44, height: 44, border: "1px solid #d8cdbc", background: "#fffaf2", borderRadius: 8, cursor: "pointer" }}
                      aria-label={`Assembly options for ${assembly.name}`}
                    >
                      ⋯
                    </button>
                    {openMenuId === assembly.id && (
                      <div
                        ref={menuRef}
                        style={{ position: "absolute", right: 0, top: 46, zIndex: 30, minWidth: 170, border: "1px solid #d8cdbc", borderRadius: 10, background: "#fffaf2", boxShadow: "0 10px 20px rgba(47,42,36,0.12)", padding: 6, display: "grid", gap: 4 }}
                      >
                        <button onClick={() => { openEditDialog(assembly.id); setOpenMenuId(null); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Edit</button>
                        <button onClick={() => { onDuplicateAssembly(assembly.id); setOpenMenuId(null); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Duplicate</button>
                        <button onClick={() => { void saveAssemblyToLibrary(assembly); setOpenMenuId(null); }} style={{ textAlign: "left", border: "none", background: "transparent", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>Save to Library</button>
                        <button
                          onClick={() => {
                            if (!window.confirm(`Delete "${assembly.name}"?`)) {
                              return;
                            }
                            onDeleteAssembly(assembly.id);
                            setOpenMenuId(null);
                          }}
                          style={{ textAlign: "left", border: "none", background: "transparent", color: "#a1260d", minHeight: 44, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#4b453d", fontSize: 13 }}>
                  <div>Labour subtotal: {formatCurrency(totals.labourSubtotal)}</div>
                  <div>Material subtotal: {formatCurrency(totals.materialSubtotal)}</div>
                  <div>Markup: {formatCurrency(totals.markupAmount)}</div>
                  <div style={{ fontWeight: 700 }}>Assembly total: {formatCurrency(totals.total)}</div>
                </div>

                {expanded && (
                  <div style={{ marginTop: 10, borderTop: "1px solid #eee2d3", paddingTop: 10, color: "#5f564c", fontSize: 13, display: "grid", gap: 8 }}>
                    {assembly.description && <div><strong>Description:</strong> {assembly.description}</div>}
                    <div><strong>Tax handling:</strong> {TAX_LABELS[assembly.taxHandling]}</div>
                    <div><strong>Waste:</strong> {assembly.wastePercent}% ({formatCurrency(totals.wasteAmount)})</div>
                    <div><strong>Pre-tax total:</strong> {formatCurrency(totals.preTaxTotal)}</div>
                    {assembly.notes && <div><strong>Notes:</strong> {assembly.notes}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isLibraryImportOpen && (
        <div onClick={() => setIsLibraryImportOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(32, 25, 19, 0.35)", display: "grid", placeItems: "center", zIndex: 70, padding: 14 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "min(860px, 100%)", maxHeight: "90vh", overflow: "auto", background: "#fffaf2", border: "1px solid #d8cdbc", borderRadius: 14, padding: 16, boxShadow: "0 18px 34px rgba(47,42,36,0.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Add from Library</h3>
              <button onClick={() => setIsLibraryImportOpen(false)} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", background: "#fff", padding: "10px 12px", cursor: "pointer" }}>Close</button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 8, gridTemplateColumns: "minmax(220px,1fr) minmax(180px,260px)" }}>
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search library templates"
                style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }}
              />
              <select
                value={libraryCategoryFilter}
                onChange={(event) => setLibraryCategoryFilter(event.target.value)}
                style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}
              >
                {libraryCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            {libraryError && (
              <div style={{ marginTop: 10, border: "1px solid #e4b6ac", background: "#fff0ed", color: "#7d2613", borderRadius: 8, padding: "10px 12px" }}>
                {libraryError}
              </div>
            )}

            {libraryLoading ? (
              <div style={{ marginTop: 12, border: "1px dashed #d8cdbc", borderRadius: 8, padding: 12, color: "#766b5d" }}>Loading Assembly Library...</div>
            ) : filteredLibraryTemplates.length === 0 ? (
              <div style={{ marginTop: 12, border: "1px dashed #d8cdbc", borderRadius: 8, padding: 12, color: "#766b5d" }}>
                No templates found. Create reusable templates in the Assembly Library page, or save an existing project assembly to the library.
              </div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {filteredLibraryTemplates.map((template) => {
                  const checked = selectedTemplateIds[template.id] === true;
                  const totals = calculateAssemblyTotals(template);
                  return (
                    <label key={template.id} style={{ border: "1px solid #e6dac8", borderRadius: 10, background: checked ? "#f4ecdf" : "#fff", padding: 10, display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const isChecked = event.target.checked;
                          setSelectedTemplateIds((current) => ({ ...current, [template.id]: isChecked }));
                        }}
                        style={{ marginTop: 4, width: 18, height: 18 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{template.name}</div>
                        <div style={{ marginTop: 4, color: "#766b5d", fontSize: 13 }}>{template.category} • {template.quantity} {template.unit} • Template</div>
                        <div style={{ marginTop: 6, color: "#4b453d", fontSize: 13 }}>
                          {formatCurrency(totals.total)} total • Labour {formatCurrency(totals.labourSubtotal)} • Materials {formatCurrency(totals.materialSubtotal)}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ color: "#766b5d", fontSize: 13 }}>
                {Object.values(selectedTemplateIds).filter(Boolean).length} selected
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setIsLibraryImportOpen(false)} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", background: "#fff", padding: "10px 12px", cursor: "pointer" }}>Cancel</button>
                <button onClick={importSelectedTemplates} style={{ minHeight: 44, borderRadius: 8, border: "none", background: "#594f43", color: "#fff", padding: "10px 14px", cursor: "pointer" }}>Import selected</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {draft && editorMode && (
        <div onClick={closeDialog} style={{ position: "fixed", inset: 0, background: "rgba(32, 25, 19, 0.35)", display: "grid", placeItems: "center", zIndex: 70, padding: 14 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "min(880px, 100%)", maxHeight: "90vh", overflow: "auto", background: "#fffaf2", border: "1px solid #d8cdbc", borderRadius: 14, padding: 16, boxShadow: "0 18px 34px rgba(47,42,36,0.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{editorMode === "create" ? "Create assembly" : "Edit assembly"}</h3>
              <button onClick={closeDialog} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", background: "#fff", padding: "10px 12px", cursor: "pointer" }}>Done</button>
            </div>

            {validationError && (
              <div style={{ marginTop: 10, border: "1px solid #e4b6ac", background: "#fff0ed", color: "#7d2613", borderRadius: 8, padding: "10px 12px" }}>
                {validationError}
              </div>
            )}
            {isTakeoffControlled && editingAssembly?.takeoffControl && (
              <div style={{ marginTop: 10, border: "1px solid #d8cdbc", background: "#fff", color: "#594f43", borderRadius: 8, padding: "10px 12px" }}>
                Quantity is controlled by Takeoff item {editingAssembly.takeoffControl.takeoffItemName}. Unlink it in the Takeoff section to edit this quantity manually.
              </div>
            )}

            <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Name</span>
                <input value={draft.name} onChange={(event) => updateDraftField("name", event.target.value)} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Category</span>
                <select value={draft.category} onChange={(event) => updateDraftField("category", event.target.value as ProjectAssemblyRecord["category"])} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}>
                  {ASSEMBLY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Quantity</span>
                <input value={draft.quantity} onChange={(event) => updateDraftField("quantity", parseNumberInput(event.target.value, 1))} inputMode="decimal" disabled={isTakeoffControlled} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: isTakeoffControlled ? "#f8f1e6" : "#fff", color: isTakeoffControlled ? "#766b5d" : "#2f2a24" }} />
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
                <select value={draft.taxHandling} onChange={(event) => updateDraftField("taxHandling", event.target.value as ProjectAssemblyRecord["taxHandling"])} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", padding: "10px 12px", background: "#fff" }}>
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
              <span>Assembly notes</span>
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

            {editorMode === "create" && (
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <button onClick={closeDialog} style={{ minHeight: 44, borderRadius: 8, border: "1px solid #d8cdbc", background: "#fff", padding: "10px 12px", cursor: "pointer" }}>Cancel</button>
                <button onClick={saveCreateAssembly} style={{ minHeight: 44, borderRadius: 8, border: "none", background: "#594f43", color: "#fff", padding: "10px 14px", cursor: "pointer" }}>Create assembly</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
