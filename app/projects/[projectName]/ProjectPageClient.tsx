"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assemblyComponents as masterAssemblyComponents } from "../../../data/assembly-components";
import { assemblies as masterAssemblies, type Assembly, type AssemblyComponent, type ComponentStatus, type ProjectAssembly } from "../../../data/assemblies";
import { recomputeProjectUnderstanding, type ProjectUnderstanding as PrototypeProjectUnderstanding } from "../../../lib/project-understanding";

type ProjectFileMeta = {
  id: string;
  filename: string;
  type: string;
  size: number;
  uploadedAt: string;
  folder: string;
};

type FileFilter = "All" | "Drawings" | "Photos" | "Videos" | "Notes" | "Documents";
type ProjectFolder = Exclude<FileFilter, "All">;

const INLINE_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

type ProjectUnderstanding = PrototypeProjectUnderstanding;

type EditingField = 'projectType' | 'possibleRooms' | 'detectedScope' | 'missingInformation';

type EditingItem = {
  field: EditingField;
  index: number;
};

type NoteCategory = "General" | "Client" | "Site" | "Scope" | "Pricing" | "Decision";

type ProjectNote = {
  id: string;
  text: string;
  category: NoteCategory;
  createdAt: string;
  updatedAt: string;
};

type ActivityType =
  | "file-uploaded"
  | "file-deleted"
  | "file-renamed"
  | "file-moved"
  | "project-title-updated"
  | "project-notes-updated"
  | "project-understanding-updated"
  | "assembly-added"
  | "assembly-edited"
  | "assembly-removed"
  | "project-archived"
  | "project-restored"
  | "update"
  | "decision"
  | "client-request"
  | "site-condition"
  | "project";

type ActivitySource = "system" | "user" | "ai";

type ActivityEntry = {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  source: ActivitySource;
  relatedFile: string | null;
  relatedFolder: string | null;
  metadata: Record<string, unknown>;
};

type ActivityFilter = "All" | "Files" | "Notes" | "Decisions" | "Project" | "AI";

type PersistedProjectData = {
  schemaVersion: number;
  displayTitle: string;
  notes: ProjectNote[];
  activity: ActivityEntry[];
  assemblies: ProjectAssembly[];
  understandingOverrides: Partial<ProjectUnderstanding>;
  attributionData: Record<string, "AI" | "User">;
  updatedAt: string;
};

type ProjectDataPatch = Partial<{
  displayTitle: string;
  notes: ProjectNote[];
  activity: ActivityEntry[];
  assemblies: ProjectAssembly[];
  understandingOverrides: Partial<ProjectUnderstanding>;
  attributionData: Record<string, "AI" | "User">;
}>;

type SaveStatus = "idle" | "saving" | "saved" | "error";

type WorkspaceProjectActionResponse = {
  success: boolean;
  projectName?: string;
  message?: string;
};

const NOTE_CATEGORIES: NoteCategory[] = ["General", "Client", "Site", "Scope", "Pricing", "Decision"];

const ACTIVITY_FILTERS: ActivityFilter[] = ["All", "Files", "Notes", "Decisions", "Project", "AI"];

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

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toIso = (value?: string) => {
  if (!value) return new Date().toISOString();
  const time = Date.parse(value);
  if (Number.isNaN(time)) return new Date().toISOString();
  return new Date(time).toISOString();
};

const activityTypeBadge = (type: ActivityType) => {
  switch (type) {
    case "file-uploaded":
    case "file-deleted":
    case "file-renamed":
    case "file-moved":
      return "Files";
    case "project-notes-updated":
      return "Notes";
    case "decision":
      return "Decision";
    case "project-understanding-updated":
      return "AI";
    default:
      return "Project";
  }
};

const activityTypeIcon = (type: ActivityType) => {
  switch (type) {
    case "file-uploaded":
      return "⬆";
    case "file-deleted":
      return "🗑";
    case "file-renamed":
      return "✎";
    case "file-moved":
      return "↦";
    case "project-notes-updated":
      return "📝";
    case "decision":
      return "◆";
    case "client-request":
      return "👤";
    case "site-condition":
      return "📍";
    case "project-understanding-updated":
      return "AI";
    case "assembly-added":
    case "assembly-edited":
    case "assembly-removed":
      return "⚙";
    default:
      return "•";
  }
};

const dayLabel = (iso: string) => {
  const ts = new Date(iso);
  const now = new Date();

  const startOfTs = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()).getTime();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((startOfNow - startOfTs) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return ts.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function ProjectPageClient({ projectName }: { projectName: string }) {
  const router = useRouter();
  const storageKey = `dimcan:projectUnderstanding:${projectName}`;
  const titleStorageKey = `dimcan:projectTitle:${projectName}`;
  const notesStorageKey = `dimcan:projectNotes:${projectName}`;
  const activityStorageKey = `dimcan:projectActivity:${projectName}`;
  const attrStorageKey = `dimcan:projectAttr:${projectName}`;
  const assemblyStorageKey = `dimcan:projectAssemblies:${projectName}`;
  const migrationKey = `dimcan:projectMigrated:${projectName}`;

  const [projectTitle, setProjectTitle] = useState(projectName);
  const [titleDraft, setTitleDraft] = useState(projectName);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const [projectFiles, setProjectFiles] = useState<ProjectFileMeta[]>([]);
  const [selectedFileFilter, setSelectedFileFilter] = useState<FileFilter>("All");
  const [isFilesLoading, setIsFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);
  const [fileDialogState, setFileDialogState] = useState<{
    mode: "rename" | "move";
    file: ProjectFileMeta;
  } | null>(null);
  const [fileDialogFilename, setFileDialogFilename] = useState("");
  const [fileDialogTargetFolder, setFileDialogTargetFolder] = useState<ProjectFolder>("Documents");
  const [fileDialogError, setFileDialogError] = useState<string | null>(null);
  const [fileDialogSuccess, setFileDialogSuccess] = useState<string | null>(null);
  const [isFileDialogSaving, setIsFileDialogSaving] = useState(false);
  const fileDialogInputRef = useRef<HTMLInputElement | null>(null);
  const [hoveredFileRowId, setHoveredFileRowId] = useState<string | null>(null);
  const [pressedFileRowId, setPressedFileRowId] = useState<string | null>(null);
  const [focusedFileRowId, setFocusedFileRowId] = useState<string | null>(null);
  const [sharingFileId, setSharingFileId] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveStatusTimerRef = useRef<number | null>(null);

  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteCategory, setNewNoteCategory] = useState<NoteCategory>("General");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const noteEditOriginalRef = useRef<Record<string, string>>({});
  const [openNoteMenuId, setOpenNoteMenuId] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("All");
  const [expandedActivityIds, setExpandedActivityIds] = useState<Record<string, boolean>>({});
  const [openActivityMenuId, setOpenActivityMenuId] = useState<string | null>(null);
  const [showManualUpdateForm, setShowManualUpdateForm] = useState(false);
  const [manualUpdateType, setManualUpdateType] = useState<"update" | "decision" | "client-request" | "site-condition">("update");
  const [manualUpdateTitle, setManualUpdateTitle] = useState("");
  const [manualUpdateDescription, setManualUpdateDescription] = useState("");

  const [assembliesState, setAssembliesState] = useState<ProjectAssembly[]>([]);
  const [showAssemblyPicker, setShowAssemblyPicker] = useState(false);
  const [assemblySearch, setAssemblySearch] = useState("");
  const [assemblyCategory, setAssemblyCategory] = useState("All");
  const [expandedAssemblies, setExpandedAssemblies] = useState<Record<string, boolean>>({});

  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [scopeExpanded, setScopeExpanded] = useState(true);
  const [missingOpen, setMissingOpen] = useState(false);
  const [showPrototypeDetails, setShowPrototypeDetails] = useState(false);

  const combinedNotesText = useMemo(
    () => projectNotes.map((note) => note.text.trim()).filter(Boolean).join("\n"),
    [projectNotes],
  );

  const [userUnderstanding, setUserUnderstanding] = useState<Partial<ProjectUnderstanding>>({});
  const understanding = useMemo<ProjectUnderstanding>(() => {
    const prototype = recomputeProjectUnderstanding({
      projectName: projectTitle,
      notes: combinedNotesText,
      files: projectFiles,
      assemblies: assembliesState.map((item) => ({ assembly: { name: item.assembly.name }, sourceAssemblyId: item.sourceAssemblyId })),
    });

    return {
      ...prototype,
      projectType: userUnderstanding.projectType ?? prototype.projectType,
      projectContext: userUnderstanding.projectContext ?? prototype.projectContext,
      confidence: userUnderstanding.confidence ?? prototype.confidence,
      detectedFiles: userUnderstanding.detectedFiles ?? prototype.detectedFiles,
      possibleRooms: userUnderstanding.possibleRooms ?? prototype.possibleRooms,
      detectedScope: userUnderstanding.detectedScope ?? prototype.detectedScope,
      missingInformation: userUnderstanding.missingInformation ?? prototype.missingInformation,
      assumptions: userUnderstanding.assumptions ?? prototype.assumptions,
      detectedAssemblies: userUnderstanding.detectedAssemblies ?? prototype.detectedAssemblies,
      scope: userUnderstanding.scope ?? prototype.scope,
      suggestedProjectName: userUnderstanding.suggestedProjectName ?? prototype.suggestedProjectName,
    };
  }, [assembliesState, combinedNotesText, projectFiles, projectTitle, userUnderstanding]);

  const [attributionState, setAttributionState] = useState<Record<string, "AI" | "User">>({});

  const assemblyCategories = useMemo(() => ["All", ...Array.from(new Set(masterAssemblies.map((assembly) => assembly.category)))], []);
  const fileFilters = useMemo<FileFilter[]>(() => ["All", "Drawings", "Photos", "Videos", "Notes", "Documents"], []);
  const projectFolders = useMemo<ProjectFolder[]>(() => ["Photos", "Videos", "Drawings", "Notes", "Documents"], []);
  const fileFilterCounts = useMemo<Record<FileFilter, number>>(() => {
    const counts: Record<FileFilter, number> = {
      All: projectFiles.length,
      Drawings: 0,
      Photos: 0,
      Videos: 0,
      Notes: 0,
      Documents: 0,
    };

    for (const file of projectFiles) {
      const folder = file.folder as FileFilter;
      if (folder in counts) {
        counts[folder] += 1;
      }
    }

    return counts;
  }, [projectFiles]);
  const visibleProjectFiles = useMemo(() => {
    if (selectedFileFilter === "All") {
      return projectFiles;
    }

    return projectFiles.filter((file) => file.folder === selectedFileFilter);
  }, [projectFiles, selectedFileFilter]);
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

  const activityByFilter = useMemo(() => {
    if (activityFilter === "All") {
      return activity;
    }

    return activity.filter((entry) => {
      if (activityFilter === "Files") {
        return entry.type.startsWith("file-");
      }
      if (activityFilter === "Notes") {
        return entry.type === "project-notes-updated";
      }
      if (activityFilter === "Decisions") {
        return entry.type === "decision";
      }
      if (activityFilter === "Project") {
        return entry.source !== "ai";
      }
      if (activityFilter === "AI") {
        return entry.source === "ai" || entry.type === "project-understanding-updated";
      }
      return true;
    });
  }, [activity, activityFilter]);

  const groupedActivity = useMemo(() => {
    const groups = new Map<string, ActivityEntry[]>();
    for (const entry of activityByFilter) {
      const label = dayLabel(entry.timestamp);
      const group = groups.get(label) ?? [];
      group.push(entry);
      groups.set(label, group);
    }
    return Array.from(groups.entries());
  }, [activityByFilter]);

  const findProjectFile = useCallback((filename: string | null, folder: string | null) => {
    if (!filename || !folder) {
      return null;
    }
    return projectFiles.find((file) => file.filename === filename && file.folder === folder) ?? null;
  }, [projectFiles]);

  function openActivityRelatedFile(entry: ActivityEntry) {
    const file = findProjectFile(entry.relatedFile, entry.relatedFolder);
    if (!file) {
      return;
    }
    setFileActionError(null);
    openProjectFile(file, "preview", false);
  }

  const setSaveStatusWithTimeout = useCallback((nextStatus: SaveStatus) => {
    setSaveStatus(nextStatus);

    if (saveStatusTimerRef.current) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }

    if (nextStatus === "saved") {
      saveStatusTimerRef.current = window.setTimeout(() => {
        setSaveStatus("idle");
        saveStatusTimerRef.current = null;
      }, 1200) as unknown as number;
    }
  }, []);

  const migrateLocalProjectStorage = useCallback((fromName: string, toName: string) => {
    if (typeof window === "undefined" || fromName === toName) {
      return;
    }

    const keyPairs: Array<[string, string]> = [
      [`dimcan:projectUnderstanding:${fromName}`, `dimcan:projectUnderstanding:${toName}`],
      [`dimcan:projectTitle:${fromName}`, `dimcan:projectTitle:${toName}`],
      [`dimcan:projectNotes:${fromName}`, `dimcan:projectNotes:${toName}`],
      [`dimcan:projectActivity:${fromName}`, `dimcan:projectActivity:${toName}`],
      [`dimcan:projectAttr:${fromName}`, `dimcan:projectAttr:${toName}`],
      [`dimcan:projectAssemblies:${fromName}`, `dimcan:projectAssemblies:${toName}`],
      [`dimcan:projectMigrated:${fromName}`, `dimcan:projectMigrated:${toName}`],
    ];

    for (const [fromKey, toKey] of keyPairs) {
      const existing = window.localStorage.getItem(fromKey);
      if (existing === null) {
        continue;
      }
      window.localStorage.setItem(toKey, existing);
      window.localStorage.removeItem(fromKey);
    }
  }, []);

  const getLocalFallbackProjectData = useCallback(() => {
    const localDisplayTitle = readStorageValue(titleStorageKey, projectName);
    const localNotes = readStorageValue<ProjectNote[] | string>(notesStorageKey, []);
    const localActivity = readStorageValue<ActivityEntry[] | string[]>(activityStorageKey, []);
    const localAssemblies = readStorageValue<ProjectAssembly[]>(assemblyStorageKey, []);
    const localUnderstanding = readStorageValue<Partial<ProjectUnderstanding>>(storageKey, {});
    const localAttribution = readStorageValue<Record<string, "AI" | "User">>(attrStorageKey, {});

    const normalizedLocalNotes = Array.isArray(localNotes)
      ? localNotes
      : typeof localNotes === "string" && localNotes.trim()
        ? [{ id: makeId(), text: localNotes.trim(), category: "General" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
        : [];

    const normalizedLocalActivity = Array.isArray(localActivity)
      ? localActivity.map((entry) => {
          if (typeof entry === "string") {
            return {
              id: makeId(),
              type: "project" as const,
              title: "Legacy activity",
              description: entry,
              timestamp: new Date().toISOString(),
              source: "system" as const,
              relatedFile: null,
              relatedFolder: null,
              metadata: { migratedFrom: "string" },
            };
          }
          return {
            ...entry,
            id: entry.id || makeId(),
            timestamp: toIso(entry.timestamp),
            metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
          };
        })
      : [];

    const patch: ProjectDataPatch = {
      displayTitle: localDisplayTitle,
      notes: normalizedLocalNotes,
      activity: normalizedLocalActivity,
      assemblies: localAssemblies,
      understandingOverrides: localUnderstanding,
      attributionData: localAttribution,
    };

    const hasData =
      localDisplayTitle.trim() !== "" && localDisplayTitle !== projectName
        ? true
        : normalizedLocalNotes.length > 0 ||
          normalizedLocalActivity.length > 0 ||
          localAssemblies.length > 0 ||
          Object.keys(localUnderstanding).length > 0 ||
          Object.keys(localAttribution).length > 0;

    return {
      patch,
      hasData,
    };
  }, [activityStorageKey, assemblyStorageKey, attrStorageKey, notesStorageKey, projectName, storageKey, titleStorageKey]);

  const applyProjectData = useCallback((project: PersistedProjectData) => {
    const safeTitle = (project.displayTitle || projectName).trim() || projectName;

    setProjectTitle(safeTitle);
    setTitleDraft(safeTitle);
    setProjectNotes(Array.isArray(project.notes) ? project.notes : []);
    setActivity(Array.isArray(project.activity) ? project.activity : []);
    setAssembliesState(Array.isArray(project.assemblies) ? project.assemblies : []);
    setUserUnderstanding(
      project.understandingOverrides && typeof project.understandingOverrides === "object"
        ? project.understandingOverrides
        : {},
    );
    setAttributionState(
      project.attributionData && typeof project.attributionData === "object"
        ? project.attributionData
        : {},
    );
  }, [projectName]);

  const saveProjectPatch = useCallback(async (patch: ProjectDataPatch) => {
    setSaveStatusWithTimeout("saving");

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });

      const data = await res.json() as { message?: string };
      if (!res.ok) {
        throw new Error(data.message || "Failed to save project data.");
      }

      setSaveStatusWithTimeout("saved");
    } catch {
      setSaveStatusWithTimeout("error");
    }
  }, [projectName, setSaveStatusWithTimeout]);

  const loadProjectData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json() as {
        project?: PersistedProjectData;
        isEmpty?: boolean;
        message?: string;
      };

      if (!res.ok || !data.project) {
        throw new Error(data.message || "Failed to load project data.");
      }

      let effectiveProject = data.project;
      const migrationDone = readStorageValue<boolean>(migrationKey, false);
      const fallbackLocal = getLocalFallbackProjectData();

      if (!migrationDone && data.isEmpty && fallbackLocal.hasData) {
        const migrateRes = await fetch(`/api/projects/${encodeURIComponent(projectName)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fallbackLocal.patch),
        });

        if (migrateRes.ok) {
          const migrateData = await migrateRes.json() as { project?: PersistedProjectData };
          if (migrateData.project) {
            effectiveProject = migrateData.project;
            writeStorageValue(migrationKey, true);
          }
        }
      }

      applyProjectData(effectiveProject);
      writeStorageValue(titleStorageKey, effectiveProject.displayTitle);
      writeStorageValue(notesStorageKey, effectiveProject.notes);
      writeStorageValue(activityStorageKey, effectiveProject.activity);
      writeStorageValue(assemblyStorageKey, effectiveProject.assemblies);
      writeStorageValue(storageKey, effectiveProject.understandingOverrides);
      writeStorageValue(attrStorageKey, effectiveProject.attributionData);
    } catch {
      const fallbackLocal = getLocalFallbackProjectData();
      applyProjectData({
        schemaVersion: 2,
        displayTitle: fallbackLocal.patch.displayTitle || projectName,
        notes: fallbackLocal.patch.notes || [],
        activity: fallbackLocal.patch.activity || [],
        assemblies: fallbackLocal.patch.assemblies || [],
        understandingOverrides: fallbackLocal.patch.understandingOverrides || {},
        attributionData: fallbackLocal.patch.attributionData || {},
        updatedAt: new Date().toISOString(),
      });
      setSaveStatus("error");
    }
  }, [activityStorageKey, applyProjectData, assemblyStorageKey, attrStorageKey, getLocalFallbackProjectData, migrationKey, notesStorageKey, projectName, storageKey, titleStorageKey]);

  const loadProjectFiles = useCallback(async () => {
    setIsFilesLoading(true);
    setFilesError(null);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`, {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await res.json() as { files?: ProjectFileMeta[]; message?: string };

      if (!res.ok) {
        throw new Error(data.message || 'Failed to load files');
      }

      setProjectFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setFilesError('Failed to load project files.');
    } finally {
      setIsFilesLoading(false);
    }
  }, [projectName]);

  const appendActivity = useCallback((entry: Omit<ActivityEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }) => {
    setActivity((current) => {
      const normalized: ActivityEntry = {
        id: entry.id || makeId(),
        type: entry.type,
        title: entry.title.trim() || "Project update",
        description: entry.description.trim(),
        timestamp: entry.timestamp ? toIso(entry.timestamp) : new Date().toISOString(),
        source: entry.source,
        relatedFile: entry.relatedFile ?? null,
        relatedFolder: entry.relatedFolder ?? null,
        metadata: entry.metadata || {},
      };

      const duplicate = current.some((item) => (
        item.type === normalized.type &&
        item.title === normalized.title &&
        item.description === normalized.description &&
        item.relatedFile === normalized.relatedFile &&
        item.relatedFolder === normalized.relatedFolder &&
        Math.abs(Date.parse(item.timestamp) - Date.parse(normalized.timestamp)) < 1500
      ));

      if (duplicate) {
        return current;
      }

      const next = [normalized, ...current].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      writeStorageValue(activityStorageKey, next);
      void saveProjectPatch({ activity: next });
      return next;
    });
  }, [activityStorageKey, saveProjectPatch]);

  const appendProjectActivity = useCallback((type: ActivityType, title: string, description = "", metadata: Record<string, unknown> = {}) => {
    appendActivity({
      type,
      title,
      description,
      source: type === "project-understanding-updated" ? "ai" : "system",
      relatedFile: null,
      relatedFolder: null,
      metadata,
    });
  }, [appendActivity]);

  const persistAssemblies = (next: ProjectAssembly[]) => {
    setAssembliesState(next);
    writeStorageValue(assemblyStorageKey, next);
    void saveProjectPatch({ assemblies: next });
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
    appendProjectActivity("assembly-added", "Assembly added", assembly.name, { assemblyId: assembly.id });
    setShowAssemblyPicker(false);
  };

  const removeAssembly = (assemblyId: string) => {
    if (!window.confirm("Remove this assembly from the project?")) return;

    const next = assembliesState.filter((item) => item.id !== assemblyId);
    persistAssemblies(next);
    appendProjectActivity("assembly-removed", "Assembly removed", "A project assembly was removed.", { assemblyId });
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
      appendProjectActivity("assembly-edited", "Assembly edited", "Assembly component status updated.", { assemblyId, componentId });
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
      appendProjectActivity("assembly-edited", "Assembly edited", `Assembly field updated: ${field}.`, { assemblyId, componentId, field });
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

  const saveTitle = async (next: string) => {
    const requestedName = next.trim();

    if (!requestedName) {
      setTitleError("Enter a project name.");
      return;
    }

    if (requestedName === projectName) {
      setProjectTitle(requestedName);
      setTitleDraft(requestedName);
      setIsEditingTitle(false);
      setTitleError(null);
      writeStorageValue(titleStorageKey, requestedName);
      return;
    }

    setTitleError(null);
    setSaveStatusWithTimeout("saving");

    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "rename",
          projectName,
          newProjectName: requestedName,
        }),
      });

      const data = await response.json() as WorkspaceProjectActionResponse;

      if (!response.ok || !data.success || !data.projectName) {
        setSaveStatusWithTimeout("error");
        setTitleError(data.message ?? "The project could not be renamed.");
        return;
      }

      const nextName = data.projectName;
      migrateLocalProjectStorage(projectName, nextName);
      writeStorageValue(`dimcan:projectTitle:${nextName}`, nextName);

      setProjectTitle(nextName);
      setTitleDraft(nextName);
      setIsEditingTitle(false);
      setTitleError(null);
      setSaveStatusWithTimeout("saved");

      router.replace(`/projects/${encodeURIComponent(nextName)}`);
      router.refresh();
    } catch {
      setSaveStatusWithTimeout("error");
      setTitleError("The project could not be renamed.");
    }
  };
  const cancelTitle = () => { setTitleDraft(projectTitle); setIsEditingTitle(false); setTitleError(null); };

  const getAttrKey = (field: EditingField, index?: number) => index !== undefined ? `${field}:${index}` : field;
  const getAttribution = (field: EditingField, index: number) => attributionState[getAttrKey(field, index)] ?? 'AI';
  const setItemAttribution = (field: EditingField, index: number, value: 'AI' | 'User') => {
    setAttributionState((current) => {
      const next = { ...current, [getAttrKey(field, index)]: value };
      writeStorageValue(attrStorageKey, next);
      void saveProjectPatch({ attributionData: next });
      return next;
    });
  };
  const clearAttribution = () => {
    setAttributionState({});
    writeStorageValue(attrStorageKey, {});
    void saveProjectPatch({ attributionData: {} });
  };

  const persistUnderstanding = (next: Partial<ProjectUnderstanding>) => {
    setUserUnderstanding(next);
    writeStorageValue(storageKey, next);
    void saveProjectPatch({ understandingOverrides: next });
  };

  const refreshUnderstanding = () => {
    const next = recomputeProjectUnderstanding({
      projectName: projectTitle,
      notes: combinedNotesText,
      files: projectFiles,
      assemblies: assembliesState.map((item) => ({ assembly: { name: item.assembly.name }, sourceAssemblyId: item.sourceAssemblyId })),
    });
    setUserUnderstanding({
      ...userUnderstanding,
      ...next,
      projectType: next.projectType,
      projectContext: next.projectContext,
      confidence: next.confidence,
      detectedFiles: next.detectedFiles,
      possibleRooms: next.possibleRooms,
      detectedScope: next.detectedScope,
      missingInformation: next.missingInformation,
      assumptions: next.assumptions,
      detectedAssemblies: next.detectedAssemblies,
      scope: next.scope,
      suggestedProjectName: next.suggestedProjectName,
    });
    writeStorageValue(storageKey, next);
    void saveProjectPatch({ understandingOverrides: next });
    appendProjectActivity("project-understanding-updated", "Project understanding updated", "Understanding was recomputed from current project inputs.");
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
      const currentArray = (understanding[editingItem.field] ?? []) as string[];
      const nextArray = [...currentArray];
      nextArray[editingItem.index] = value;
      persistUnderstanding({ ...userUnderstanding, [editingItem.field]: nextArray });
    }

    setItemAttribution(editingItem.field, editingItem.index, 'User');
    appendProjectActivity("project-understanding-updated", "Project understanding edited", `${editingItem.field} item updated by user.`);
    setEditingItem(null);
    setEditingValue('');
  };

  useEffect(() => {
    if (editingItem) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingItem]);

  useEffect(() => {
    void loadProjectData();
  }, [loadProjectData]);

  useEffect(() => {
    void loadProjectFiles();
  }, [loadProjectFiles]);

  useEffect(() => {
    return () => {
      if (saveStatusTimerRef.current) {
        window.clearTimeout(saveStatusTimerRef.current);
      }
      for (const timerId of Object.values(noteSaveTimersRef.current)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  useEffect(() => {
    if (fileDialogState?.mode === "rename") {
      fileDialogInputRef.current?.focus();
      fileDialogInputRef.current?.select();
    }
  }, [fileDialogState]);

  useEffect(() => {
    const closeMenuOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!fileMenuRef.current) {
        return;
      }

      const target = event.target as Node | null;
      if (target && !fileMenuRef.current.contains(target)) {
        setOpenFileMenuId(null);
      }
    };

    window.addEventListener('mousedown', closeMenuOnOutsideClick);
    window.addEventListener('touchstart', closeMenuOnOutsideClick);

    return () => {
      window.removeEventListener('mousedown', closeMenuOnOutsideClick);
      window.removeEventListener('touchstart', closeMenuOnOutsideClick);
    };
  }, []);

  // Files upload/delete
  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileDragEnter = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsFileDropActive(true);
  };

  const handleFileDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsFileDropActive(false);
    }
  };

  const handleFileDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsFileDropActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  const getFileOpenHref = (file: ProjectFileMeta) => {
    const search = new URLSearchParams({
      folder: file.folder,
      filename: file.filename,
    });
    return `/api/projects/${encodeURIComponent(projectName)}/files?${search.toString()}`;
  };

  const shouldOpenFileInTab = (file: ProjectFileMeta) => {
    const type = (file.type || "").toLowerCase();
    if (type.startsWith("image/") || type === "application/pdf") {
      return true;
    }

    const extension = file.filename.split('.').pop()?.toLowerCase() || "";
    return INLINE_EXTENSIONS.has(extension);
  };

  const openProjectFile = (file: ProjectFileMeta, mode: 'preview' | 'browser' | 'download' = 'preview', trackActivity = true) => {
    const href = getFileOpenHref(file);
    const openInTab = shouldOpenFileInTab(file);

    if (trackActivity) {
      appendActivity({
        type: "project",
        title:
          mode === "download"
            ? "File downloaded"
            : mode === "browser"
              ? "File opened in browser"
              : openInTab
                ? "File opened"
                : "File downloaded",
        description: `${file.filename} from ${file.folder}.`,
        source: "user",
        relatedFile: file.filename,
        relatedFolder: file.folder,
        metadata: { action: mode },
      });
    }

    if (mode === 'download') {
      const link = document.createElement('a');
      link.href = href;
      link.download = file.filename;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    if (mode === 'browser') {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }

    if (openInTab) {
      window.location.href = href;
      return;
    }

    const link = document.createElement('a');
    link.href = href;
    link.download = file.filename;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const shareProjectFile = async (file: ProjectFileMeta) => {
    setFileActionError(null);
    setSharingFileId(file.id);

    try {
      const href = getFileOpenHref(file);
      const absoluteUrl = new URL(href, window.location.origin).toString();

      if (typeof navigator.share !== 'function') {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(absoluteUrl);
          appendActivity({
            type: "project",
            title: "File share link copied",
            description: `${file.filename} link copied to clipboard.`,
            source: "user",
            relatedFile: file.filename,
            relatedFolder: file.folder,
            metadata: { method: "clipboard" },
          });
          return;
        }

        throw new Error('Sharing is not supported on this device.');
      }

      const response = await fetch(href, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Could not load file for sharing.');
      }

      const blob = await response.blob();
      const shareFile = new File([blob], file.filename, {
        type: blob.type || file.type || 'application/octet-stream',
      });

      const canShareFiles =
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [shareFile] });

      if (canShareFiles) {
        await navigator.share({
          title: file.filename,
          files: [shareFile],
        });
        appendActivity({
          type: "project",
          title: "File shared",
          description: `${file.filename} shared from ${file.folder}.`,
          source: "user",
          relatedFile: file.filename,
          relatedFolder: file.folder,
          metadata: { method: "native-share-file" },
        });
        return;
      }

      await navigator.share({
        title: file.filename,
        url: absoluteUrl,
      });
      appendActivity({
        type: "project",
        title: "File shared",
        description: `${file.filename} shared from ${file.folder}.`,
        source: "user",
        relatedFile: file.filename,
        relatedFolder: file.folder,
        metadata: { method: "native-share-url" },
      });
    } catch (error) {
      const isAbortError =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name?: string }).name === 'AbortError';

      if (!isAbortError) {
        try {
          const href = getFileOpenHref(file);
          const absoluteUrl = new URL(href, window.location.origin).toString();

          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(absoluteUrl);
            appendActivity({
              type: "project",
              title: "File share link copied",
              description: `${file.filename} link copied to clipboard.`,
              source: "user",
              relatedFile: file.filename,
              relatedFolder: file.folder,
              metadata: { method: "clipboard-fallback" },
            });
          } else {
            throw new Error('Could not share this file.');
          }
        } catch {
          setFileActionError('Could not share this file.');
        }
      }
    } finally {
      setSharingFileId(null);
    }
  };

  const confirmAndDeleteFile = async (file: ProjectFileMeta) => {
    const confirmed = window.confirm(`Delete ${file.filename} from ${file.folder}?`);
    if (!confirmed) {
      return;
    }

    setOpenFileMenuId(null);
    await deleteFile(file);
  };

  const closeFileDialog = () => {
    setFileDialogState(null);
    setFileDialogFilename("");
    setFileDialogTargetFolder("Documents");
    setFileDialogError(null);
    setFileDialogSuccess(null);
    setIsFileDialogSaving(false);
  };

  const openRenameDialog = (file: ProjectFileMeta) => {
    setFileDialogState({ mode: "rename", file });
    setFileDialogFilename(file.filename);
    setFileDialogTargetFolder(file.folder as ProjectFolder);
    setFileDialogError(null);
    setFileDialogSuccess(null);
    setIsFileDialogSaving(false);
  };

  const openMoveDialog = (file: ProjectFileMeta) => {
    setFileDialogState({ mode: "move", file });
    setFileDialogFilename(file.filename);
    setFileDialogTargetFolder(file.folder as ProjectFolder);
    setFileDialogError(null);
    setFileDialogSuccess(null);
    setIsFileDialogSaving(false);
  };

  const applyUpdatedFileMeta = (sourceFileId: string, updatedFile: ProjectFileMeta) => {
    setProjectFiles((current) => {
      const next = current.map((file) => (file.id === sourceFileId ? updatedFile : file));
      return next.sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
    });
  };

  const submitFileDialog = async () => {
    if (!fileDialogState || isFileDialogSaving) {
      return;
    }

    const sourceFile = fileDialogState.file;
    setFileDialogError(null);
    setFileDialogSuccess(null);

    if (fileDialogState.mode === "rename") {
      const nextFilename = fileDialogFilename.trim();
      if (!nextFilename) {
        setFileDialogError("Enter a new filename.");
        return;
      }

      if (nextFilename === sourceFile.filename) {
        setFileDialogError("New filename must be different.");
        return;
      }
    }

    if (fileDialogState.mode === "move") {
      if (!projectFolders.includes(fileDialogTargetFolder)) {
        setFileDialogError("Choose a valid destination folder.");
        return;
      }

      if (fileDialogTargetFolder === sourceFile.folder) {
        setFileDialogError("File is already in that folder.");
        return;
      }
    }

    setIsFileDialogSaving(true);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          fileDialogState.mode === "rename"
            ? {
                action: "rename",
                folder: sourceFile.folder,
                filename: sourceFile.filename,
                newFilename: fileDialogFilename,
              }
            : {
                action: "move",
                folder: sourceFile.folder,
                filename: sourceFile.filename,
                targetFolder: fileDialogTargetFolder,
              },
        ),
      });

      const data = await res.json() as {
        file?: ProjectFileMeta;
        message?: string;
      };

      if (!res.ok || !data.file) {
        throw new Error(data.message || "File update failed.");
      }

      applyUpdatedFileMeta(sourceFile.id, data.file);

      if (fileDialogState.mode === "rename") {
        appendActivity({
          type: "file-renamed",
          title: "File renamed",
          description: `${sourceFile.filename} renamed to ${data.file.filename}.`,
          source: "user",
          relatedFile: data.file.filename,
          relatedFolder: data.file.folder,
          metadata: {
            fromFilename: sourceFile.filename,
            toFilename: data.file.filename,
            folder: data.file.folder,
          },
        });
        setFileDialogSuccess("File renamed successfully.");
      } else {
        appendActivity({
          type: "file-moved",
          title: "File moved",
          description: `${sourceFile.filename} moved from ${sourceFile.folder} to ${data.file.folder}.`,
          source: "user",
          relatedFile: data.file.filename,
          relatedFolder: data.file.folder,
          metadata: {
            filename: data.file.filename,
            fromFolder: sourceFile.folder,
            toFolder: data.file.folder,
          },
        });
        setFileDialogSuccess("File moved successfully.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update this file.";
      setFileDialogError(message);
    } finally {
      setIsFileDialogSaving(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    setFilesError(null);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`, { method: 'POST', body: form });
      const data = await res.json() as {
        files?: Array<Pick<ProjectFileMeta, "filename" | "folder" | "size">>;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(data.message || 'Failed to upload files');
      }

      await loadProjectFiles();

      const uploadedFromApi = Array.isArray(data.files) ? data.files : [];
      if (uploadedFromApi.length > 0) {
        for (const uploaded of uploadedFromApi) {
          appendActivity({
            type: "file-uploaded",
            title: "File uploaded",
            description: `${uploaded.filename} uploaded to ${uploaded.folder}.`,
            source: "user",
            relatedFile: uploaded.filename,
            relatedFolder: uploaded.folder,
            metadata: { size: uploaded.size },
          });
        }
      } else {
        appendActivity({
          type: "file-uploaded",
          title: files.length === 1 ? "File uploaded" : `${files.length} files uploaded`,
          description: files.length === 1 ? "A file was uploaded to the project." : "Multiple files were uploaded to the project.",
          source: "user",
          relatedFile: files.length === 1 ? files[0]?.name ?? null : null,
          relatedFolder: null,
          metadata: { count: files.length },
        });
      }
    } catch {
      setFilesError('Failed to upload files.');
    }
  };

  const deleteFile = async (file: ProjectFileMeta) => {
    setFilesError(null);

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.filename, folder: file.folder }),
      });
      const data = await res.json() as { message?: string };

      if (!res.ok) {
        throw new Error(data.message || 'Failed to delete file');
      }

      await loadProjectFiles();
      appendActivity({
        type: "file-deleted",
        title: "File deleted",
        description: `${file.filename} was deleted from ${file.folder}.`,
        source: "user",
        relatedFile: file.filename,
        relatedFolder: file.folder,
        metadata: {},
      });
    } catch {
      setFilesError('Failed to delete file.');
    }
  };

  const saveNotesSnapshot = useCallback((nextNotes: ProjectNote[]) => {
    writeStorageValue(notesStorageKey, nextNotes);
    void saveProjectPatch({ notes: nextNotes });
  }, [notesStorageKey, saveProjectPatch]);

  const addNote = () => {
    const text = newNoteText.trim();
    if (!text) {
      return;
    }

    const now = new Date().toISOString();
    const newNote: ProjectNote = {
      id: makeId(),
      text,
      category: newNoteCategory,
      createdAt: now,
      updatedAt: now,
    };

    setProjectNotes((current) => {
      const next = [newNote, ...current];
      saveNotesSnapshot(next);
      return next;
    });

    appendActivity({
      type: "project-notes-updated",
      title: "Note added",
      description: text.slice(0, 140),
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { category: newNoteCategory, noteId: newNote.id },
    });

    setNewNoteText("");
    setNewNoteCategory("General");
  };

  const beginNoteEdit = (note: ProjectNote) => {
    noteEditOriginalRef.current[note.id] = note.text;
    setEditingNoteId(note.id);
  };

  const finishNoteEdit = (note: ProjectNote) => {
    const original = noteEditOriginalRef.current[note.id] ?? "";
    const current = note.text.trim();
    const previous = original.trim();

    if (current && current !== previous) {
      appendActivity({
        type: "project-notes-updated",
        title: "Note edited",
        description: "A project note was updated.",
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: { noteId: note.id },
      });
    }

    delete noteEditOriginalRef.current[note.id];
    setEditingNoteId((currentId) => (currentId === note.id ? null : currentId));
  };

  const updateNoteText = (noteId: string, text: string) => {
    setProjectNotes((current) => current.map((note) => (
      note.id === noteId
        ? { ...note, text, updatedAt: new Date().toISOString() }
        : note
    )));

    const activeTimer = noteSaveTimersRef.current[noteId];
    if (activeTimer) {
      window.clearTimeout(activeTimer);
    }

    noteSaveTimersRef.current[noteId] = window.setTimeout(() => {
      setProjectNotes((latest) => {
        saveNotesSnapshot(latest);
        return latest;
      });
      delete noteSaveTimersRef.current[noteId];
    }, 500) as unknown as number;
  };

  const updateNoteCategory = (noteId: string, category: NoteCategory) => {
    setProjectNotes((current) => {
      const next = current.map((note) => (
        note.id === noteId
          ? { ...note, category, updatedAt: new Date().toISOString() }
          : note
      ));
      saveNotesSnapshot(next);
      return next;
    });

    appendActivity({
      type: "project-notes-updated",
      title: "Note category changed",
      description: `A note was moved to ${category}.`,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { noteId, category },
    });
  };

  const deleteNote = (noteId: string) => {
    if (!window.confirm("Delete this note?")) {
      return;
    }

    setProjectNotes((current) => {
      const next = current.filter((note) => note.id !== noteId);
      saveNotesSnapshot(next);
      return next;
    });

    appendActivity({
      type: "project-notes-updated",
      title: "Note deleted",
      description: "A note was removed from the project.",
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { noteId },
    });

    setOpenNoteMenuId(null);
  };

  const addManualActivity = () => {
    const title = manualUpdateTitle.trim();
    const description = manualUpdateDescription.trim();
    if (!title) {
      return;
    }

    appendActivity({
      type: manualUpdateType,
      title,
      description,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: {},
    });

    setShowManualUpdateForm(false);
    setManualUpdateType("update");
    setManualUpdateTitle("");
    setManualUpdateDescription("");
  };

  const [showEstimate, setShowEstimate] = useState(false);

  return (
    <main style={{ minHeight: '100vh', background: '#f4efe5', color: '#2f2a24', padding: 'clamp(12px, 3vw, 28px)', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 980, margin: '0 auto' }}>
        <Link href="/" style={{ display: 'inline-block', marginBottom: 18, color: '#766b5d', textDecoration: 'none' }}>← Back to Workspace</Link>

        <header style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: '#766b5d', fontSize: 14 }}>Dimcan Project</p>
          {isEditingTitle ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <input ref={titleInputRef} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') void saveTitle(titleDraft); if (e.key==='Escape') cancelTitle(); }} onBlur={() => { void saveTitle(titleDraft); }} style={{ fontSize: 28, fontWeight: 700, padding: '8px 12px', borderRadius: 10, border: '1px solid #d8cdbc' }} />
            </div>
          ) : (
            <h1 onClick={() => { setTitleError(null); setIsEditingTitle(true); }} style={{ margin: '8px 0 0', fontSize: 'clamp(26px, 5vw, 32px)', fontWeight: 700, cursor: 'pointer' }}>{projectTitle}</h1>
          )}
          <p style={{ margin: '8px 0 0', color: saveStatus === 'error' ? '#a1260d' : '#9a8f80', fontSize: 12 }}>
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save' : '\u00a0'}
          </p>
          {titleError && (
            <p style={{ margin: '6px 0 0', color: '#a1260d', fontSize: 13 }}>
              {titleError}
            </p>
          )}
        </header>

        <section
          onDragEnter={handleFileDragEnter}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
          style={{
            background: isFileDropActive ? '#f3e8d8' : '#fffaf2',
            border: `1px solid ${isFileDropActive ? '#594f43' : '#d8cdbc'}`,
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Project Files</h2>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              onClick={openFilePicker}
              role="button"
              tabIndex={0}
              style={{
                padding: '10px 20px',
                border: '2px dashed #d8cdbc',
                borderRadius: 10,
                background: '#f8f1e5',
                cursor: 'pointer',
              }}
              onKeyDown={(e)=>{ if (e.key==='Enter') openFilePicker(); }}
            >
              <input ref={fileInputRef} type="file" multiple hidden onChange={(e)=>handleFiles(e.target.files)} />
              <div style={{ fontSize: 18, fontWeight: 700 }}>Upload or drag files</div>
            </div>

            <div style={{ width: '100%', marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {fileFilters.map((filter) => {
                  const isActive = selectedFileFilter === filter;
                  return (
                    <button
                      key={filter}
                      onClick={() => setSelectedFileFilter(filter)}
                      style={{
                        border: '1px solid #d8cdbc',
                        background: isActive ? '#594f43' : '#fffaf2',
                        color: isActive ? '#fff' : '#2f2a24',
                        padding: '6px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {filter} ({fileFilterCounts[filter]})
                    </button>
                  );
                })}
              </div>

              {filesError ? (
                <p style={{ margin: 0, color: '#a1260d' }}>{filesError}</p>
              ) : isFilesLoading ? (
                <p style={{ margin: 0, color: '#766b5d' }}>Loading files...</p>
              ) : visibleProjectFiles.length === 0 ? (
                <p style={{ margin: 0, color: '#766b5d' }}>No files uploaded</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {sharingFileId && (
                    <p style={{ margin: '0 0 2px', color: '#766b5d', fontSize: 12 }}>Preparing file for sharing...</p>
                  )}
                  {fileActionError && (
                    <p style={{ margin: '0 0 2px', color: '#a1260d', fontSize: 12 }}>{fileActionError}</p>
                  )}
                  {visibleProjectFiles.map((f) => (
                    <div
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setFileActionError(null);
                        openProjectFile(f, 'preview');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setFileActionError(null);
                          openProjectFile(f, 'preview');
                        }
                      }}
                      onMouseEnter={() => setHoveredFileRowId(f.id)}
                      onMouseLeave={() => {
                        setHoveredFileRowId((current) => (current === f.id ? null : current));
                        setPressedFileRowId((current) => (current === f.id ? null : current));
                      }}
                      onMouseDown={() => setPressedFileRowId(f.id)}
                      onMouseUp={() => setPressedFileRowId((current) => (current === f.id ? null : current))}
                      onFocus={() => setFocusedFileRowId(f.id)}
                      onBlur={() => {
                        setFocusedFileRowId((current) => (current === f.id ? null : current));
                        setPressedFileRowId((current) => (current === f.id ? null : current));
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: pressedFileRowId === f.id ? '#f1e6d7' : hoveredFileRowId === f.id ? '#fbf5ec' : '#fff',
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${focusedFileRowId === f.id ? '#594f43' : '#e6dac8'}`,
                        boxShadow: focusedFileRowId === f.id ? '0 0 0 2px rgba(89,79,67,0.15)' : 'none',
                        cursor: 'pointer',
                        transition: 'background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
                        position: 'relative',
                      }}
                    >
                      <div style={{ width: 40, height: 40, minWidth: 40, borderRadius: 10, background: '#f8f1e5', display: 'grid', placeItems: 'center', fontSize: 18 }}>{f.type.startsWith('image/') ? '🖼️' : f.type === 'application/pdf' ? '📕' : '📄'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 700, color: '#2f2a24', wordBreak: 'break-word' }}>{f.filename}</div>
                          <span style={{ border: '1px solid #d8cdbc', background: '#fffaf2', color: '#766b5d', borderRadius: 999, padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>{f.folder}</span>
                        </div>
                        <div style={{ color: '#9a8f80', fontSize: 12, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span>{f.size ? `${(f.size/1000).toFixed(1)} KB` : f.type}</span>
                          <span>•</span>
                          <span>{new Date(f.uploadedAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpenFileMenuId((current) => (current === f.id ? null : f.id));
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setOpenFileMenuId((current) => (current === f.id ? null : f.id));
                            }
                          }}
                          aria-label={`File options for ${f.filename}`}
                          style={{
                            width: 44,
                            height: 44,
                            minWidth: 44,
                            borderRadius: 10,
                            border: '1px solid #d8cdbc',
                            background: '#fffaf2',
                            color: '#594f43',
                            fontSize: 20,
                            lineHeight: 1,
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            padding: 0,
                          }}
                        >
                          ⋯
                        </button>

                        {openFileMenuId === f.id && (
                          <div
                            ref={fileMenuRef}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: 46,
                              zIndex: 20,
                              minWidth: 180,
                              background: '#fffaf2',
                              border: '1px solid #d8cdbc',
                              borderRadius: 10,
                              boxShadow: '0 10px 20px rgba(47,42,36,0.12)',
                              padding: 6,
                              display: 'grid',
                              gap: 4,
                            }}
                          >
                            <button
                              onClick={() => { void shareProjectFile(f); setOpenFileMenuId(null); }}
                              disabled={sharingFileId === f.id}
                              style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#2f2a24', padding: '8px 10px', borderRadius: 8, cursor: sharingFileId === f.id ? 'wait' : 'pointer', fontWeight: 700 }}
                            >
                              {sharingFileId === f.id ? 'Preparing share...' : 'Share / Open with...'}
                            </button>
                            <button onClick={() => { openProjectFile(f, 'browser'); setOpenFileMenuId(null); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#2f2a24', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Open in browser</button>
                            <button onClick={() => { openProjectFile(f, 'download'); setOpenFileMenuId(null); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#2f2a24', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Download to Files</button>
                            <button onClick={() => { openRenameDialog(f); setOpenFileMenuId(null); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#2f2a24', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', minHeight: 44 }}>Rename</button>
                            <button onClick={() => { openMoveDialog(f); setOpenFileMenuId(null); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#2f2a24', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', minHeight: 44 }}>Move to folder</button>
                            <button onClick={() => { void confirmAndDeleteFile(f); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#a1260d', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Project Notes</h2>
            <div style={{ color: saveStatus === 'error' ? '#a1260d' : '#9a8f80', fontSize: 12 }}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save' : '\u00a0'}
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <textarea
              value={newNoteText}
              onChange={(event) => setNewNoteText(event.target.value)}
              placeholder="Add a project note, client request, site observation, or decision..."
              style={{ width: '100%', minHeight: 88, padding: 12, borderRadius: 8, border: '1px solid #d8cdbc', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={newNoteCategory}
                onChange={(event) => setNewNoteCategory(event.target.value as NoteCategory)}
                style={{ border: '1px solid #d8cdbc', background: '#fff', padding: '10px 12px', borderRadius: 8, minHeight: 44 }}
              >
                {NOTE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <button
                onClick={addNote}
                style={{ border: 'none', background: '#594f43', color: '#fff', padding: '10px 14px', borderRadius: 8, minHeight: 44, cursor: 'pointer' }}
              >
                Add Note
              </button>
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {projectNotes.length === 0 ? (
              <div style={{ border: '1px dashed #d8cdbc', borderRadius: 8, padding: 12, color: '#766b5d' }}>
                No notes yet. Add a note to capture project decisions and updates.
              </div>
            ) : (
              projectNotes.map((note) => (
                <div key={note.id} style={{ background: '#fff', border: '1px solid #e6dac8', borderRadius: 10, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ border: '1px solid #d8cdbc', background: '#fffaf2', color: '#766b5d', borderRadius: 999, padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>{note.category}</span>
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setOpenNoteMenuId((current) => current === note.id ? null : note.id)}
                        style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid #d8cdbc', background: '#fffaf2', color: '#594f43', cursor: 'pointer' }}
                        aria-label={`Note options for ${note.category}`}
                      >
                        ⋯
                      </button>
                      {openNoteMenuId === note.id && (
                        <div style={{ position: 'absolute', right: 0, top: 46, zIndex: 15, minWidth: 150, background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 10, boxShadow: '0 10px 20px rgba(47,42,36,0.12)', padding: 6, display: 'grid', gap: 4 }}>
                          <button onClick={() => { beginNoteEdit(note); setOpenNoteMenuId(null); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Edit</button>
                          <button onClick={() => deleteNote(note.id)} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#a1260d', padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {editingNoteId === note.id ? (
                    <textarea
                      value={note.text}
                      onChange={(event) => updateNoteText(note.id, event.target.value)}
                      onBlur={() => finishNoteEdit(note)}
                      style={{ width: '100%', marginTop: 8, minHeight: 90, padding: 10, borderRadius: 8, border: '1px solid #d8cdbc', boxSizing: 'border-box' }}
                    />
                  ) : (
                    <div onClick={() => beginNoteEdit(note)} style={{ marginTop: 8, whiteSpace: 'pre-wrap', cursor: 'text' }}>{note.text}</div>
                  )}

                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', color: '#9a8f80', fontSize: 12 }}>
                    <div>Created: {new Date(note.createdAt).toLocaleString()}</div>
                    <div>Edited: {new Date(note.updatedAt).toLocaleString()}</div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <select
                      value={note.category}
                      onChange={(event) => updateNoteCategory(note.id, event.target.value as NoteCategory)}
                      style={{ border: '1px solid #d8cdbc', background: '#fff', padding: '8px 10px', borderRadius: 8, minHeight: 40 }}
                    >
                      {NOTE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Assemblies</h2>
              <button onClick={() => setShowAssemblyPicker((value) => !value)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '10px 14px', borderRadius: 8, cursor: 'pointer', minHeight: 44 }}>{showAssemblyPicker ? 'Hide picker' : 'Add Assembly'}</button>
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
                        <button onClick={() => addAssembly(assembly)} style={{ border: 'none', background: '#594f43', color: '#fff', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', minHeight: 44 }}>Add</button>
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
                        <button onClick={() => toggleAssemblyExpanded(projectAssembly.id)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', minHeight: 44 }}>{isExpanded ? 'Collapse' : 'Expand'} </button>
                        <button onClick={() => removeAssembly(projectAssembly.id)} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', minHeight: 44 }}>Remove</button>
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

        <section style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Project Understanding</h2>
              <div style={{ marginTop: 6, color: '#766b5d', fontSize: 13 }}>AI prototype workspace • local deterministic suggestions only</div>
            </div>
            <div style={{ color: '#766b5d', fontWeight: 700 }}>Confidence: {understanding.confidence}%</div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Suggested project name</div>
              <div style={{ color: '#2f2a24' }}>{understanding.suggestedProjectName || projectTitle}</div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Project context</div>
              <div style={{ color: '#766b5d' }}>{understanding.projectContext || 'No project context yet'}</div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>Inputs</div>
                <button onClick={() => setShowPrototypeDetails((value) => !value)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#594f43' }}>{showPrototypeDetails ? 'Hide details' : 'Show details'}</button>
              </div>
              {showPrototypeDetails && (
                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                  <div><strong>Files:</strong> {understanding.detectedFiles.join(', ') || 'No files uploaded'}</div>
                  <div><strong>Notes:</strong> {combinedNotesText || 'No notes yet'}</div>
                  <div><strong>Assemblies:</strong> {understanding.detectedAssemblies.join(', ') || 'No assemblies selected'}</div>
                </div>
              )}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6dac8', padding: 12, borderRadius: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Understanding</div>
              <div style={{ color: '#766b5d', display: 'grid', gap: 8 }}>
                <div><strong>Scope:</strong> {understanding.scope.join(' • ') || 'No scope yet'}</div>
                <div><strong>Assumptions:</strong> {understanding.assumptions.join(' • ') || 'No assumptions yet'}</div>
                <div><strong>Detected or suggested assemblies:</strong> {understanding.detectedAssemblies.join(', ') || 'No assemblies yet'}</div>
              </div>
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
                <div style={{ fontWeight: 700 }}>⚠ Missing information ({understanding.missingInformation.length})</div>
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

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={refreshUnderstanding} style={{ background: '#594f43', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: 8, minHeight: 44 }}>Refresh Understanding</button>
              <button onClick={() => {
                persistUnderstanding({});
                clearAttribution();
                appendProjectActivity('project-understanding-updated', 'Understanding overrides cleared', 'User reset understanding overrides to AI baseline.');
              }} style={{ border: '1px solid #d8cdbc', background: '#fffaf2', padding: '10px 14px', borderRadius: 8, minHeight: 44 }}>Accept/Edit Suggestions</button>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Activity</h2>
            <button
              onClick={() => setShowManualUpdateForm((current) => !current)}
              style={{ border: '1px solid #d8cdbc', background: '#fff', color: '#2f2a24', borderRadius: 8, minHeight: 44, padding: '10px 12px', cursor: 'pointer' }}
            >
              Add update
            </button>
          </div>

          {showManualUpdateForm && (
            <div style={{ marginTop: 10, background: '#fff', border: '1px solid #e6dac8', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
              <select
                value={manualUpdateType}
                onChange={(event) => setManualUpdateType(event.target.value as "update" | "decision" | "client-request" | "site-condition")}
                style={{ border: '1px solid #d8cdbc', borderRadius: 8, padding: '10px 12px', minHeight: 44 }}
              >
                <option value="update">Update</option>
                <option value="decision">Decision</option>
                <option value="client-request">Client request</option>
                <option value="site-condition">Site condition</option>
              </select>
              <input
                value={manualUpdateTitle}
                onChange={(event) => setManualUpdateTitle(event.target.value)}
                placeholder="Short title"
                style={{ border: '1px solid #d8cdbc', borderRadius: 8, padding: '10px 12px', minHeight: 44 }}
              />
              <textarea
                value={manualUpdateDescription}
                onChange={(event) => setManualUpdateDescription(event.target.value)}
                placeholder="Optional details"
                style={{ border: '1px solid #d8cdbc', borderRadius: 8, padding: 10, minHeight: 88 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={addManualActivity} style={{ border: 'none', background: '#594f43', color: '#fff', minHeight: 44, padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}>Save update</button>
                <button
                  onClick={() => {
                    setShowManualUpdateForm(false);
                    setManualUpdateTitle('');
                    setManualUpdateDescription('');
                  }}
                  style={{ border: '1px solid #d8cdbc', background: '#fffaf2', minHeight: 44, padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ACTIVITY_FILTERS.map((filter) => {
              const isActive = activityFilter === filter;
              return (
                <button
                  key={filter}
                  onClick={() => setActivityFilter(filter)}
                  style={{ border: '1px solid #d8cdbc', background: isActive ? '#594f43' : '#fff', color: isActive ? '#fff' : '#2f2a24', borderRadius: 999, minHeight: 40, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                >
                  {filter}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            {groupedActivity.length === 0 ? (
              <div style={{ border: '1px dashed #d8cdbc', borderRadius: 8, padding: 12, color: '#766b5d' }}>
                {activityFilter === 'All' ? 'No project activity yet.' : `No activity in ${activityFilter}.`}
              </div>
            ) : (
              groupedActivity.map(([groupLabel, entries]) => (
                <div key={groupLabel} style={{ display: 'grid', gap: 8 }}>
                  <div style={{ color: '#766b5d', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>{groupLabel}</div>
                  {entries.map((entry) => {
                    const relatedFile = findProjectFile(entry.relatedFile, entry.relatedFolder);
                    const isExpanded = expandedActivityIds[entry.id] === true;
                    const isDecision = entry.type === 'decision';

                    return (
                      <div key={entry.id} style={{ background: '#fff', border: `1px solid ${isDecision ? '#d7c09a' : '#e6dac8'}`, borderRadius: 10, padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ color: '#594f43', fontWeight: 700, minWidth: 20 }}>{activityTypeIcon(entry.type)}</span>
                              <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{entry.title}</div>
                              <span style={{ border: '1px solid #d8cdbc', background: '#fffaf2', color: '#766b5d', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{activityTypeBadge(entry.type)}</span>
                            </div>
                            <div style={{ marginTop: 4, color: '#766b5d', fontSize: 12 }}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {entry.source.toUpperCase()}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {entry.description && (
                              <button onClick={() => setExpandedActivityIds((current) => ({ ...current, [entry.id]: !current[entry.id] }))} style={{ minHeight: 36, border: '1px solid #d8cdbc', background: '#fffaf2', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>{isExpanded ? 'Hide' : 'More'}</button>
                            )}
                            <button onClick={() => setOpenActivityMenuId((current) => current === entry.id ? null : entry.id)} style={{ width: 44, height: 44, border: '1px solid #d8cdbc', background: '#fffaf2', borderRadius: 8, cursor: 'pointer' }}>⋯</button>
                          </div>
                        </div>

                        {isExpanded && entry.description && (
                          <div style={{ marginTop: 8, color: '#4b453d', whiteSpace: 'pre-wrap' }}>{entry.description}</div>
                        )}

                        {entry.relatedFile && entry.relatedFolder && (
                          <div style={{ marginTop: 8, fontSize: 12 }}>
                            {relatedFile ? (
                              <button
                                onClick={() => openActivityRelatedFile(entry)}
                                style={{ border: '1px solid #d8cdbc', background: '#fff', color: '#2f2a24', borderRadius: 8, minHeight: 36, padding: '6px 10px', cursor: 'pointer' }}
                              >
                                Open {entry.relatedFile}
                              </button>
                            ) : (
                              <span style={{ color: '#9a8f80' }}>Related file unavailable: {entry.relatedFile}</span>
                            )}
                          </div>
                        )}

                        {openActivityMenuId === entry.id && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {relatedFile && (
                              <button onClick={() => openActivityRelatedFile(entry)} style={{ border: '1px solid #d8cdbc', background: '#fff', borderRadius: 8, minHeight: 36, padding: '6px 10px', cursor: 'pointer' }}>Open file</button>
                            )}
                            <button
                              onClick={() => {
                                if (!window.confirm('Delete this activity entry?')) {
                                  return;
                                }
                                setActivity((current) => {
                                  const next = current.filter((item) => item.id !== entry.id);
                                  writeStorageValue(activityStorageKey, next);
                                  void saveProjectPatch({ activity: next });
                                  return next;
                                });
                                setOpenActivityMenuId(null);
                              }}
                              style={{ border: '1px solid #d8cdbc', background: '#fff', color: '#a1260d', borderRadius: 8, minHeight: 36, padding: '6px 10px', cursor: 'pointer' }}
                            >
                              Delete entry
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
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

      {fileDialogState && (
        <div
          onClick={closeFileDialog}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(32, 25, 19, 0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 60,
            padding: 14,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(560px, 100%)',
              background: '#fffaf2',
              border: '1px solid #d8cdbc',
              borderRadius: 14,
              padding: 16,
              boxShadow: '0 18px 34px rgba(47,42,36,0.22)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {fileDialogState.mode === 'rename' ? 'Rename file' : 'Move file'}
            </h3>
            <p style={{ margin: '8px 0 0', color: '#766b5d', fontSize: 14, wordBreak: 'break-word' }}>
              {fileDialogState.file.filename} in {fileDialogState.file.folder}
            </p>

            <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              {fileDialogState.mode === 'rename' ? (
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#594f43', fontWeight: 700 }}>New filename</span>
                  <input
                    ref={fileDialogInputRef}
                    value={fileDialogFilename}
                    onChange={(event) => setFileDialogFilename(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitFileDialog();
                      }
                    }}
                    placeholder="Enter file name"
                    style={{
                      minHeight: 44,
                      borderRadius: 8,
                      border: '1px solid #d8cdbc',
                      padding: '10px 12px',
                      fontSize: 14,
                    }}
                  />
                  <span style={{ color: '#8b7f70', fontSize: 12 }}>
                    If you leave out the extension, the current extension is preserved.
                  </span>
                </label>
              ) : (
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#594f43', fontWeight: 700 }}>Destination folder</span>
                  <select
                    value={fileDialogTargetFolder}
                    onChange={(event) => setFileDialogTargetFolder(event.target.value as ProjectFolder)}
                    style={{
                      minHeight: 44,
                      borderRadius: 8,
                      border: '1px solid #d8cdbc',
                      padding: '10px 12px',
                      fontSize: 14,
                      background: '#fff',
                    }}
                  >
                    {projectFolders.map((folder) => (
                      <option key={folder} value={folder}>{folder}</option>
                    ))}
                  </select>
                </label>
              )}

              {fileDialogError && (
                <div style={{ color: '#a1260d', fontSize: 13 }}>{fileDialogError}</div>
              )}
              {fileDialogSuccess && (
                <div style={{ color: '#2f6f42', fontSize: 13 }}>{fileDialogSuccess}</div>
              )}
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                onClick={closeFileDialog}
                style={{
                  minHeight: 44,
                  borderRadius: 8,
                  border: '1px solid #d8cdbc',
                  background: '#fffaf2',
                  color: '#2f2a24',
                  padding: '10px 14px',
                  cursor: 'pointer',
                }}
              >
                {fileDialogSuccess ? 'Done' : 'Cancel'}
              </button>
              {!fileDialogSuccess && (
                <button
                  onClick={() => { void submitFileDialog(); }}
                  disabled={isFileDialogSaving}
                  style={{
                    minHeight: 44,
                    borderRadius: 8,
                    border: 'none',
                    background: '#594f43',
                    color: '#fff',
                    padding: '10px 14px',
                    cursor: isFileDialogSaving ? 'wait' : 'pointer',
                    opacity: isFileDialogSaving ? 0.75 : 1,
                  }}
                >
                  {isFileDialogSaving
                    ? fileDialogState.mode === 'rename' ? 'Renaming...' : 'Moving...'
                    : fileDialogState.mode === 'rename' ? 'Rename file' : 'Move file'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
