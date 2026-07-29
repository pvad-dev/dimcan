"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { assemblyComponents as masterAssemblyComponents } from "../../../data/assembly-components";
import { assemblies as masterAssemblies, type Assembly, type AssemblyComponent, type ComponentStatus, type ProjectAssembly } from "../../../data/assemblies";

type ProjectFileMeta = {
  id: string;
  filename: string;
  type: string;
  size: number;
  uploadedAt: string;
};

type ProjectUnderstanding = {
  projectType: string;
  confidence: number;
  detectedFiles: string[];
  possibleRooms: string[];
  detectedScope: string[];
  missingInformation: string[];
};

type EditingField = 'projectType' | 'possibleRooms' | 'detectedScope' | 'missingInformation';

type EditingItem = {
  field: EditingField;
  index: number;
};

const readStorageValue = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeStorageValue = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export default function ProjectPageClient({ projectName }: { projectName: string }) {
  const storageKey = `dimcan:projectUnderstanding:${projectName}`;
  const fileStorageKey = `dimcan:projectFiles:${projectName}`;
  const titleStorageKey = `dimcan:projectTitle:${projectName}`;
  const notesStorageKey = `dimcan:projectNotes:${projectName}`;
  const activityStorageKey = `dimcan:projectActivity:${projectName}`;
  const attrStorageKey = `dimcan:projectAttr:${projectName}`;
  const assemblyStorageKey = `dimcan:projectAssemblies:${projectName}`;

  const [projectTitle, setProjectTitle] = useState(() => readStorageValue(titleStorageKey, projectName));
  const [titleDraft, setTitleDraft] = useState(() => readStorageValue(titleStorageKey, projectName));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const [projectFiles, setProjectFiles] = useState<ProjectFileMeta[]>(() => readStorageValue<ProjectFileMeta[]>(fileStorageKey, []));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [notes, setNotes] = useState(() => readStorageValue(notesStorageKey, ""));
  const notesTimer = useRef<number | null>(null);

  const [activity, setActivity] = useState<string[]>(() => readStorageValue<string[]>(activityStorageKey, []));
  const [activityOpen, setActivityOpen] = useState(false);

  const [assembliesState, setAssembliesState] = useState<ProjectAssembly[]>(() => readStorageValue<ProjectAssembly[]>(assemblyStorageKey, []));
  const [showAssemblyPicker, setShowAssemblyPicker] = useState(false);
  const [assemblySearch, setAssemblySearch] = useState("");
  const [assemblyCategory, setAssemblyCategory] = useState("All");
  const [expandedAssemblies, setExpandedAssemblies] = useState<Record<string, boolean>>({});

  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [scopeExpanded, setScopeExpanded] = useState(true);
  const [missingOpen, setMissingOpen] = useState(false);

  // Simple mock understanding generator
  const generateMockUnderstanding = (files: ProjectFileMeta[]): ProjectUnderstanding => {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(f.filename));
    const count = files.length;
    if (count === 0) {
      return {
        projectType: "",
        confidence: 0,
        detectedFiles: [],
        possibleRooms: [],
        detectedScope: [],
        missingInformation: [],
      };
    }

    const detectedFiles = [`${count} file${count === 1 ? "" : "s"}`];

    if (images.length >= 1) {
      return {
        projectType: "Bathroom tile work",
        confidence: 72,
        detectedFiles,
        possibleRooms: ["Bathroom tub surround"],
        detectedScope: ["Demolition", "Waterproofing", "Wall Tile", "Tile Trim"],
        missingInformation: [
          "Is the bathtub staying?",
          "Confirm wall dimensions",
          "Confirm selected tile and trim",
        ],
      };
    }

    return {
      projectType: "General renovation",
      confidence: 60,
      detectedFiles,
      possibleRooms: [],
      detectedScope: [],
      missingInformation: [],
    };
  };

  const aiUnderstanding = useMemo(() => generateMockUnderstanding(projectFiles), [projectFiles]);
  const [userUnderstanding, setUserUnderstanding] = useState<Partial<ProjectUnderstanding>>(() => readStorageValue<Partial<ProjectUnderstanding>>(storageKey, {}));
  const understanding = useMemo(() => ({
    projectType: userUnderstanding.projectType ?? aiUnderstanding.projectType,
    confidence: aiUnderstanding.confidence,
    detectedFiles: aiUnderstanding.detectedFiles,
    possibleRooms: userUnderstanding.possibleRooms ?? aiUnderstanding.possibleRooms,
    detectedScope: userUnderstanding.detectedScope ?? aiUnderstanding.detectedScope,
    missingInformation: userUnderstanding.missingInformation ?? aiUnderstanding.missingInformation,
  }), [aiUnderstanding, userUnderstanding]);

  const [attributionState, setAttributionState] = useState<Record<string, "AI" | "User">>(() => readStorageValue<Record<string, "AI" | "User">>(attrStorageKey, {}));

  const assemblyCategories = useMemo(() => ["All", ...Array.from(new Set(masterAssemblies.map((assembly) => assembly.category)))], []);
  const availableAssemblies = useMemo(() => {
    const addedAssemblyIds = new Set(assembliesState.map((assembly) => assembly.sourceAssemblyId));
    const normalizedSearch = assemblySearch.trim().toLowerCase();

    return masterAssemblies.filter((assembly) => {
      if (addedAssemblyIds.has(assembly.id)) return false;
      if (assemblyCategory !== "All" && assembly.category !== assemblyCategory) return false;
      if (!normalizedSearch) return true;
      return [assembly.name, assembly.category, assembly.subcategory, assembly.projectContext]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [assemblyCategory, assemblySearch, assembliesState]);

  const persistFiles = (files: ProjectFileMeta[]) => {
    setProjectFiles(files);
    writeStorageValue(fileStorageKey, files);
  };

  const pushActivity = (text: string) => {
    const entry = `${text} — ${new Date().toLocaleString()}`;
    setActivity((current) => {
      const next = [...current, entry];
      writeStorageValue(activityStorageKey, next);
      return next;
    });
  };

  const persistAssemblies = (next: ProjectAssembly[]) => {
    setAssembliesState(next);
    writeStorageValue(assemblyStorageKey, next);
  };

  const addAssembly = (assembly: Assembly) => {
    if (assembliesState.some((item) => item.sourceAssemblyId === assembly.id)) return;

    const now = new Date().toISOString();
    const projectAssembly: ProjectAssembly = {
      id: `${assembly.id}-${now}`,
      sourceAssemblyId: assembly.id,
      projectId: projectName,
      assembly,
      components: masterAssemblyComponents
        .filter((component) => component.assemblyId === assembly.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((component) => ({
          ...component,
          componentStatus: component.requirementStatus === "Optional" ? "Optional" : component.requirementStatus === "Excluded" ? "Excluded" : "Included",
        })),
      includedStatus: "Included",
      contractorEdited: false,
      createdAt: now,
      updatedAt: now,
    };

    const next = [...assembliesState, projectAssembly];
    persistAssemblies(next);
    pushActivity(`Assembly added: ${assembly.name}`);
    setShowAssemblyPicker(false);
  };

  const removeAssembly = (assemblyId: string) => {
    if (!window.confirm("Remove this assembly from the project?")) return;

    const next = assembliesState.filter((item) => item.id !== assemblyId);
    persistAssemblies(next);
    pushActivity("Assembly removed");
  };

  const updateComponentStatus = (assemblyId: string, componentId: string, componentStatus: ComponentStatus) => {
    const next = assembliesState.map((item) => {
      if (item.id !== assemblyId) return item;
      const nextComponents = item.components.map((component) => (
        component.id === componentId ? { ...component, componentStatus } : component
      )) as Array<AssemblyComponent & { componentStatus: ComponentStatus }>;
      return {
        ...item,
        contractorEdited: true,
        components: nextComponents,
        updatedAt: new Date().toISOString(),
      };
    });

    persistAssemblies(next);
    if (!assembliesState.find((item) => item.id === assemblyId)?.contractorEdited) {
      pushActivity("Assembly component updated");
    }
  };

  const updateComponentField = (
    assemblyId: string,
    componentId: string,
    field: "requirement" | "quantityUnit" | "quantityDriver" | "typicalMaterialSystem" | "laborTask" | "notes",
    value: string,
  ) => {
    const next = assembliesState.map((item) => {
      if (item.id !== assemblyId) return item;
      const nextComponents = item.components.map((component) => (
        component.id === componentId ? { ...component, [field]: value } : component
      )) as Array<AssemblyComponent & { componentStatus: ComponentStatus }>;
      return {
        ...item,
        contractorEdited: true,
        components: nextComponents,
        updatedAt: new Date().toISOString(),
      };
    });

    persistAssemblies(next);
    if (!assembliesState.find((item) => item.id === assemblyId)?.contractorEdited) {
      pushActivity("Assembly component updated");
    }
  };

  const toggleAssemblyExpanded = (assemblyId: string) => {
    setExpandedAssemblies((current) => ({ ...current, [assemblyId]: !current[assemblyId] }));
  };

  // Title editing
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const saveTitle = (next: string) => {
    const t = next.trim() || projectName;
    setProjectTitle(t);
    setTitleDraft(t);
    setIsEditingTitle(false);
    writeStorageValue(titleStorageKey, t);
    pushActivity('Title changed');
  };
  const cancelTitle = () => { setTitleDraft(projectTitle); setIsEditingTitle(false); };

  const getAttrKey = (field: EditingField, index?: number) => index !== undefined ? `${field}:${index}` : field;
  const getAttribution = (field: EditingField, index: number) => attributionState[getAttrKey(field, index)] ?? 'AI';
  const setItemAttribution = (field: EditingField, index: number, value: 'AI' | 'User') => {
    setAttributionState((current) => {
      const next = { ...current, [getAttrKey(field, index)]: value };
      writeStorageValue(attrStorageKey, next);
      return next;
    });
  };
  const clearAttribution = () => {
    setAttributionState({});
    try { window.localStorage.removeItem(attrStorageKey); } catch {}
  };

  const persistUnderstanding = (next: Partial<ProjectUnderstanding>) => {
    setUserUnderstanding(next);
    writeStorageValue(storageKey, next);
  };

  const beginEdit = (field: EditingField, index: number) => {
    const currentValue = field === 'projectType'
      ? understanding.projectType
      : (understanding[field] as string[] | undefined)?.[index] ?? '';
    setEditingValue(currentValue);
  };

  const cancelUnderstandingEdit = () => {
    setEditingItem(null);
    setEditingValue('');
  };

  const saveUnderstandingEdit = () => {
    if (!editingItem) return;
    const value = editingValue.trim();
    if (value === '') return cancelUnderstandingEdit();

    if (editingItem.field === 'projectType') {
      persistUnderstanding({ ...userUnderstanding, projectType: value });
    } else {
      const currentArray = ((userUnderstanding[editingItem.field] ?? aiUnderstanding[editingItem.field]) ?? []) as string[];
      const nextArray = [...currentArray];
      nextArray[editingItem.index] = value;
      persistUnderstanding({ ...userUnderstanding, [editingItem.field]: nextArray });
    }

    setItemAttribution(editingItem.field, editingItem.index, 'User');
    pushActivity('Project understanding item edited');
    setEditingItem(null);
    setEditingValue('');
  };

  useEffect(() => {
    if (editingItem) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingItem]);

  // Files upload/delete
  const openFilePicker = () => fileInputRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`, { method: 'POST', body: form });
      const data = await res.json() as { files?: Array<{ name: string; size: number; type: string }> };
      const newFiles = (data.files ?? []).map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}`, filename: f.name, type: f.type, size: f.size, uploadedAt: new Date().toISOString() }));
      persistFiles([...(projectFiles ?? []), ...newFiles]);
      pushActivity(`${newFiles.length} file${newFiles.length===1? '':'s'} uploaded`);
    } catch {
      // fallback: add locally
      const localFiles = Array.from(files).map((f) => ({ id: `${f.name}-${f.size}-${Date.now()}`, filename: f.name, type: f.type, size: f.size, uploadedAt: new Date().toISOString() }));
      persistFiles([...(projectFiles ?? []), ...localFiles]);
      pushActivity(`${localFiles.length} file${localFiles.length===1? '':'s'} added (local)`);
    }
  };

  const deleteFile = (id: string) => {
    const next = projectFiles.filter((f) => f.id !== id);
    persistFiles(next);
    pushActivity('File deleted');
  };

  // Notes debounce
  const saveNotesNow = (value: string) => {
    writeStorageValue(notesStorageKey, value);
    pushActivity('Note updated');
  };
  const handleNotesChange = (v: string) => {
    setNotes(v);
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => { saveNotesNow(v); notesTimer.current = null; }, 400) as unknown as number;
  };

  const [showEstimate, setShowEstimate] = useState(false);

  return (
    <main style={{ minHeight: '100vh', background: '#f4efe5', color: '#2f2a24', padding: '28px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 900, margin: '0 auto' }}>
        <Link href="/" style={{ display: 'inline-block', marginBottom: 18, color: '#766b5d', textDecoration: 'none' }}>← Back to Workspace</Link>

        <header style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: '#766b5d', fontSize: 14 }}>Dimcan Project</p>
          {isEditingTitle ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <input ref={titleInputRef} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') saveTitle(titleDraft); if (e.key==='Escape') cancelTitle(); }} onBlur={() => saveTitle(titleDraft)} style={{ fontSize: 28, fontWeight: 700, padding: '8px 12px', borderRadius: 10, border: '1px solid #d8cdbc' }} />
            </div>
          ) : (
            <h1 onClick={() => setIsEditingTitle(true)} style={{ margin: '8px 0 0', fontSize: 32, fontWeight: 700, cursor: 'pointer' }}>{projectTitle}</h1>
          )}
        </header>

        <section style={{ background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Project Files</h2>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div onClick={openFilePicker} role="button" tabIndex={0} style={{ padding: '10px 20px', border: '2px dashed #d8cdbc', borderRadius: 10, background: '#f8f1e5', cursor: 'pointer' }} onKeyDown={(e)=>{ if (e.key==='Enter') openFilePicker(); }}>
              <input ref={fileInputRef} type="file" multiple hidden onChange={(e)=>handleFiles(e.target.files)} />
              <div style={{ fontSize: 18, fontWeight: 700 }}>Upload or drag files</div>
            </div>

            <div style={{ width: '100%', marginTop: 12 }}>
              {projectFiles.length === 0 ? (
                <p style={{ margin: 0, color: '#766b5d' }}>No files uploaded</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {projectFiles.map((f) => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #e6dac8' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f8f1e5', display: 'grid', placeItems: 'center' }}>{f.type.startsWith('image/') ? '🖼️' : '📄'}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ fontWeight: 700 }}>{f.filename}</div>
                          <div style={{ color: '#766b5d', fontSize: 13 }}>{f.size ? `${(f.size/1000).toFixed(1)} KB` : f.type}</div>
                        </div>
                        <div style={{ color: '#9a8f80', fontSize: 12 }}>{new Date(f.uploadedAt).toLocaleString()}</div>
                      </div>
                      <button onClick={() => deleteFile(f.id)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '6px 10px', borderRadius: 8, cursor: 'pointer' }}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Notes</h2>
          <textarea value={notes} onChange={(e)=>handleNotesChange(e.target.value)} placeholder="Add project notes, client instructions, site details or observations..." style={{ width: '100%', minHeight: 120, padding: 12, borderRadius: 8, border: '1px solid #d8cdbc' }} />
        </section>

        <section style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Assemblies</h2>
            <button onClick={() => setShowAssemblyPicker((value) => !value)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '10px 14px', borderRadius: 8, cursor: 'pointer' }}>{showAssemblyPicker ? 'Hide picker' : 'Add Assembly'}</button>
          </div>

          {showAssemblyPicker && (
            <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <input value={assemblySearch} onChange={(e) => setAssemblySearch(e.target.value)} placeholder="Search assemblies" style={{ flex: 1, minWidth: 220, padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
                <select value={assemblyCategory} onChange={(e) => setAssemblyCategory(e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }}>
                  {assemblyCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>

              {availableAssemblies.length === 0 ? (
                <div style={{ color: '#766b5d' }}>No matching assemblies available.</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {availableAssemblies.map((assembly) => (
                    <div key={assembly.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #f0e9df', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{assembly.name}</div>
                        <div style={{ color: '#766b5d', fontSize: 13 }}>{assembly.category} • {assembly.subcategory}</div>
                      </div>
                      <button onClick={() => addAssembly(assembly)} style={{ border: 'none', background: '#594f43', color: '#fff', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>Add</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            {assembliesState.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8, color: '#766b5d' }}>No assemblies added yet.</div>
            ) : (
              assembliesState.map((projectAssembly) => {
                const isExpanded = expandedAssemblies[projectAssembly.id];
                return (
                  <div key={projectAssembly.id} style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{projectAssembly.assembly.name}</div>
                        <div style={{ color: '#766b5d', fontSize: 13 }}>Source ID: {projectAssembly.sourceAssemblyId}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => toggleAssemblyExpanded(projectAssembly.id)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>{isExpanded ? 'Collapse' : 'Expand'} </button>
                        <button onClick={() => removeAssembly(projectAssembly.id)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Remove</button>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, display: 'grid', gap: 8, color: '#766b5d' }}>
                      <div><strong>Context/exposure:</strong> {projectAssembly.assembly.projectContext} • {projectAssembly.assembly.moistureExposure}</div>
                      <div><strong>Required functions:</strong> {projectAssembly.assembly.requiredFunctions.join(', ')}</div>
                      <div><strong>Common unknowns:</strong> {projectAssembly.assembly.commonUnknowns.join(', ')}</div>
                      <div><strong>Non-negotiables:</strong> {projectAssembly.assembly.nonNegotiables.join(', ')}</div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                        {projectAssembly.components.map((component) => (
                          <div key={component.id} style={{ borderTop: '1px solid #f0e9df', paddingTop: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                              <div style={{ fontWeight: 700 }}>{component.componentGroup}</div>
                              <select value={component.componentStatus} onChange={(e) => updateComponentStatus(projectAssembly.id, component.id, e.target.value as ComponentStatus)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid #d8cdbc' }}>
                                <option value="Included">Included</option>
                                <option value="Excluded">Excluded</option>
                                <option value="Optional">Optional</option>
                                <option value="Unknown">Unknown</option>
                              </select>
                            </div>
                            <div style={{ marginTop: 8, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                                Requirement
                                <input value={component.requirement} onChange={(e) => updateComponentField(projectAssembly.id, component.id, 'requirement', e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
                              </label>
                              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                                Quantity unit
                                <input value={component.quantityUnit} onChange={(e) => updateComponentField(projectAssembly.id, component.id, 'quantityUnit', e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
                              </label>
                              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                                Quantity driver
                                <input value={component.quantityDriver} onChange={(e) => updateComponentField(projectAssembly.id, component.id, 'quantityDriver', e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
                              </label>
                              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                                Material / system
                                <input value={component.typicalMaterialSystem} onChange={(e) => updateComponentField(projectAssembly.id, component.id, 'typicalMaterialSystem', e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
                              </label>
                              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                                Labor task
                                <input value={component.laborTask} onChange={(e) => updateComponentField(projectAssembly.id, component.id, 'laborTask', e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
                              </label>
                              <label style={{ display: 'grid', gap: 4, fontSize: 13, gridColumn: '1 / -1' }}>
                                Notes
                                <textarea value={component.notes} onChange={(e) => updateComponentField(projectAssembly.id, component.id, 'notes', e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d8cdbc', minHeight: 70 }} />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Project Understanding</h2>
            <div style={{ color: '#766b5d', fontWeight: 700 }}>Confidence: {understanding.confidence}%</div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ fontWeight: 700 }}>Detected files</div>
              <div style={{ color: '#766b5d', marginTop: 6 }}>{understanding.detectedFiles.join(', ')}</div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => beginEdit('projectType', 0)} style={{ all: 'unset', cursor: 'pointer', color: '#2f2a24', fontSize: 16, fontWeight: 700 }}>Project type</button>
                <span style={{ color: '#9a8f80' }}>{getAttribution('projectType', 0) === 'AI' ? '🤖' : '👤 Contractor'}</span>
              </div>
              {editingItem?.field === 'projectType' ? (
                <input ref={editInputRef} value={editingValue} onChange={(e) => setEditingValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUnderstandingEdit(); if (e.key === 'Escape') cancelUnderstandingEdit(); }} onBlur={saveUnderstandingEdit} style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
              ) : (
                <div onClick={() => beginEdit('projectType', 0)} style={{ marginTop: 8, color: '#766b5d', cursor: 'pointer' }}>{understanding.projectType || 'No project type detected'}</div>
              )}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>Possible area</div>
              </div>
              {editingItem?.field === 'possibleRooms' ? (
                <input ref={editInputRef} value={editingValue} onChange={(e) => setEditingValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUnderstandingEdit(); if (e.key === 'Escape') cancelUnderstandingEdit(); }} onBlur={saveUnderstandingEdit} style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 8, border: '1px solid #d8cdbc' }} />
              ) : (
                <div onClick={() => beginEdit('possibleRooms', 0)} style={{ marginTop: 8, color: '#766b5d', cursor: 'pointer' }}>
                  <span style={{ marginRight: 8 }}>{getAttribution('possibleRooms', 0) === 'AI' ? '🤖' : '👤'}</span>
                  {understanding.possibleRooms[0] || 'None detected'}
                </div>
              )}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>Scope</div>
                <button onClick={() => setScopeExpanded((s) => !s)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>{scopeExpanded ? '▼' : '▶'}</button>
              </div>
              {scopeExpanded && (
                <ul style={{ marginTop: 8, paddingLeft: 16 }}>
                  {understanding.detectedScope.map((s, i) => {
                    const attr = getAttribution('detectedScope', i);
                    const isEditing = editingItem?.field === 'detectedScope' && editingItem.index === i;
                    return (
                      <li key={s} style={{ marginBottom: 6 }}>
                        {isEditing ? (
                          <input ref={editInputRef} value={editingValue} onChange={(e) => setEditingValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUnderstandingEdit(); if (e.key === 'Escape') cancelUnderstandingEdit(); }} onBlur={saveUnderstandingEdit} style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #d8cdbc' }} />
                        ) : (
                          <span onClick={() => beginEdit('detectedScope', i)} style={{ cursor: 'pointer', color: '#2f2a24' }}>
                            {attr === 'AI' ? '🤖 ' : '👤 '} {s}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>⚠ Possible Missing Information ({understanding.missingInformation.length})</div>
                <button onClick={() => setMissingOpen((s) => !s)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>{missingOpen ? '▼' : '▶'}</button>
              </div>
              {missingOpen && (
                <ul style={{ marginTop: 8, paddingLeft: 16 }}>
                  {understanding.missingInformation.map((m, i) => {
                    const attr = getAttribution('missingInformation', i);
                    const isEditing = editingItem?.field === 'missingInformation' && editingItem.index === i;
                    return (
                      <li key={m} style={{ marginBottom: 6 }}>
                        {isEditing ? (
                          <input ref={editInputRef} value={editingValue} onChange={(e) => setEditingValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUnderstandingEdit(); if (e.key === 'Escape') cancelUnderstandingEdit(); }} onBlur={saveUnderstandingEdit} style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #d8cdbc' }} />
                        ) : (
                          <span onClick={() => beginEdit('missingInformation', i)} style={{ cursor: 'pointer', color: '#2f2a24' }}>
                            {attr === 'AI' ? '🤖 ' : '👤 '} {m}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setShowEstimate(true)} style={{ background: '#594f43', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: 8 }}>See AI Estimate</button>
              <button onClick={() => { setUserUnderstanding({}); try { localStorage.removeItem(storageKey); } catch {}; clearAttribution(); }} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '10px 14px', borderRadius: 8 }}>Reset to AI Suggestion</button>
            </div>

          </div>
        </section>

      </div>

      {/* Estimate panel */}
      {showEstimate && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, width: 320, background: '#fff', border: '1px solid #e6dac8', borderRadius: 10, padding: 12, boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700 }}>Estimate preview</div>
            <button onClick={() => setShowEstimate(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ color: '#766b5d' }}><strong>Detected area:</strong> {understanding.possibleRooms[0] ?? 'Unknown'}</div>
            <div style={{ color: '#766b5d', marginTop: 6 }}><strong>Detected scope:</strong> {understanding.detectedScope.join(', ') || 'None'}</div>
            <div style={{ color: '#766b5d', marginTop: 6 }}><strong>Unresolved missing:</strong> {understanding.missingInformation.length}</div>
            <p style={{ marginTop: 10 }}>Estimate generation will use the confirmed scope, quantities, materials, and company pricing rules.</p>
          </div>
        </div>
      )}

      {/* Activity panel bottom */}
      <div style={{ position: 'fixed', left: 20, bottom: 20, width: 320 }}>
        <div style={{ background: '#fff', border: '1px solid #e6dac8', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, cursor: 'pointer' }} onClick={() => setActivityOpen((s)=>!s)}>
            <div style={{ fontWeight: 700 }}>Activity</div>
            <div style={{ color: '#766b5d' }}>{activityOpen ? '▴' : '▾'}</div>
          </div>
          {activityOpen && (
            <div style={{ maxHeight: 220, overflow: 'auto', padding: 8 }}>
              {activity.length === 0 ? <div style={{ color: '#766b5d' }}>No activity</div> : activity.slice().reverse().map((a, i) => <div key={i} style={{ padding: 8, borderBottom: '1px solid #f0e9df' }}>{a}</div>)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
