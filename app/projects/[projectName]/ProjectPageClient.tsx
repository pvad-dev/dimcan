"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssembliesPanel from "./AssembliesPanel";
import "./project-workspace.css";
import { cloneAssembly, formatCurrency, normalizeAssemblies, type AssemblyLibraryTemplate, type ProjectAssemblyRecord } from "../../../lib/assembly-estimating";
import {
  PRICING_ADJUSTMENT_TYPES,
  PRICING_TAX_BASES,
  buildProjectPricingSummary,
  createDefaultPricingAdjustment,
  createDefaultPricingSettings,
  duplicatePricingAdjustment,
  normalizePricingAdjustments,
  normalizePricingSettings,
  normalizePricingSummary,
  type PricingAdjustment,
  type PricingAdjustmentAmountType,
  type PricingAdjustmentType,
  type PricingSettings,
  type PricingSummary,
  type PricingTaxBase,
} from "../../../lib/project-pricing";
import { recomputeProjectUnderstanding, type ProjectUnderstanding as PrototypeProjectUnderstanding } from "../../../lib/project-understanding";
import {
  TAKEOFF_CATEGORIES,
  TAKEOFF_SOURCE_TYPES,
  TAKEOFF_UNITS,
  buildTakeoffGroupKey,
  calculateTakeoffQuantities,
  createEmptyTakeoffItem,
  defaultTakeoffSettings,
  normalizeTakeoffGroups,
  normalizeTakeoffItems,
  normalizeTakeoffSettings,
  summarizeTakeoffByUnit,
  syncTakeoffGroupsWithItems,
  withUpdatedTakeoffItem,
  type TakeoffCategory,
  type TakeoffGroup,
  type TakeoffItem,
  type TakeoffSettings,
  type TakeoffSourceType,
} from "../../../lib/takeoff";

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
  | "takeoff-created"
  | "takeoff-edited"
  | "takeoff-duplicated"
  | "takeoff-deleted"
  | "takeoff-linked"
  | "takeoff-unlinked"
  | "pricing-settings-updated"
  | "pricing-adjustment-updated"
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
  assemblies: ProjectAssemblyRecord[];
  takeoffItems: TakeoffItem[];
  takeoffGroups: TakeoffGroup[];
  takeoffSettings: TakeoffSettings;
  pricingSettings: PricingSettings;
  pricingAdjustments: PricingAdjustment[];
  pricingSummary: PricingSummary;
  understandingOverrides: Partial<ProjectUnderstanding>;
  attributionData: Record<string, "AI" | "User">;
  updatedAt: string;
};

type ProjectDataPatch = Partial<{
  displayTitle: string;
  notes: ProjectNote[];
  activity: ActivityEntry[];
  assemblies: ProjectAssemblyRecord[];
  takeoffItems: TakeoffItem[];
  takeoffGroups: TakeoffGroup[];
  takeoffSettings: TakeoffSettings;
  pricingSettings: PricingSettings;
  pricingAdjustments: PricingAdjustment[];
  pricingSummary: PricingSummary;
  understandingOverrides: Partial<ProjectUnderstanding>;
  attributionData: Record<string, "AI" | "User">;
}>;

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ProjectStage = "overview" | "files" | "takeoff" | "assemblies" | "pricing" | "activity";

const PROJECT_STAGES: Array<{ id: ProjectStage; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "takeoff", label: "Takeoff" },
  { id: "assemblies", label: "Assemblies" },
  { id: "pricing", label: "Pricing" },
  { id: "activity", label: "Activity" },
];

const isProjectStage = (value: string | null): value is ProjectStage => (
  PROJECT_STAGES.some((stage) => stage.id === value)
);

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
    case "takeoff-created":
    case "takeoff-edited":
    case "takeoff-duplicated":
    case "takeoff-deleted":
    case "takeoff-linked":
    case "takeoff-unlinked":
      return "Takeoff";
    case "pricing-settings-updated":
    case "pricing-adjustment-updated":
      return "Pricing";
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
    case "takeoff-created":
      return "▣";
    case "takeoff-edited":
      return "◧";
    case "takeoff-duplicated":
      return "⧉";
    case "takeoff-deleted":
      return "✕";
    case "takeoff-linked":
      return "↔";
    case "takeoff-unlinked":
      return "⇄";
    case "pricing-settings-updated":
    case "pricing-adjustment-updated":
      return "$";
    default:
      return "•";
  }
};

const parseTakeoffNumber = (raw: string, fallback = 0) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
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
  const takeoffItemsStorageKey = `dimcan:projectTakeoffItems:${projectName}`;
  const takeoffGroupsStorageKey = `dimcan:projectTakeoffGroups:${projectName}`;
  const takeoffSettingsStorageKey = `dimcan:projectTakeoffSettings:${projectName}`;
  const pricingSettingsStorageKey = `dimcan:projectPricingSettings:${projectName}`;
  const pricingAdjustmentsStorageKey = `dimcan:projectPricingAdjustments:${projectName}`;
  const pricingSummaryStorageKey = `dimcan:projectPricingSummary:${projectName}`;
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

  const [assembliesState, setAssembliesState] = useState<ProjectAssemblyRecord[]>([]);
  const [takeoffItems, setTakeoffItems] = useState<TakeoffItem[]>([]);
  const [takeoffGroups, setTakeoffGroups] = useState<TakeoffGroup[]>([]);
  const [takeoffSettings, setTakeoffSettings] = useState<TakeoffSettings>(defaultTakeoffSettings());
  const [openTakeoffMenuId, setOpenTakeoffMenuId] = useState<string | null>(null);
  const [takeoffEditorItemId, setTakeoffEditorItemId] = useState<string | null>(null);
  const [takeoffDraft, setTakeoffDraft] = useState<TakeoffItem | null>(null);
  const [takeoffValidationError, setTakeoffValidationError] = useState<string | null>(null);
  const [takeoffUiMessage, setTakeoffUiMessage] = useState<string | null>(null);
  const [takeoffExpandedItemId, setTakeoffExpandedItemId] = useState<string | null>(null);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(createDefaultPricingSettings());
  const [pricingAdjustments, setPricingAdjustments] = useState<PricingAdjustment[]>([]);
  const [persistedPricingSummary, setPersistedPricingSummary] = useState<PricingSummary>(
    buildProjectPricingSummary({
      assemblies: [],
      takeoffItems: [],
      pricingSettings: createDefaultPricingSettings(),
      pricingAdjustments: [],
    }),
  );
  const [pricingExpanded, setPricingExpanded] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricingMessage, setPricingMessage] = useState<string | null>(null);
  const [openPricingAdjustmentMenuId, setOpenPricingAdjustmentMenuId] = useState<string | null>(null);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);
  const [isPricingAdjustmentEditorOpen, setIsPricingAdjustmentEditorOpen] = useState(false);
  const [pricingAdjustmentDraft, setPricingAdjustmentDraft] = useState<PricingAdjustment>(createDefaultPricingAdjustment());
  const pricingMessageTimerRef = useRef<number | null>(null);
  const pricingRateFocusRef = useRef<{ pstRate: number; gstRate: number } | null>(null);
  const [isProjectDataLoading, setIsProjectDataLoading] = useState(true);
  const stageStorageKey = `dimcan:projectStage:${projectName}`;
  const [activeStage, setActiveStage] = useState<ProjectStage>("overview");
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [activityVisibleCount, setActivityVisibleCount] = useState(20);
  const [activitySearch, setActivitySearch] = useState("");
  const stageScrollPositionsRef = useRef<Partial<Record<ProjectStage, number>>>({});
  const assemblySaveTimerRef = useRef<number | null>(null);
  const takeoffSaveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

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
      assemblies: assembliesState.map((item) => ({ assembly: { name: item.name }, sourceAssemblyId: item.id })),
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

  const searchedActivity = useMemo(() => {
    const query = activitySearch.trim().toLowerCase();
    if (!query) return activityByFilter;
    return activityByFilter.filter((entry) => (
      `${entry.title} ${entry.description} ${entry.relatedFile ?? ""} ${entry.relatedFolder ?? ""}`
        .toLowerCase()
        .includes(query)
    ));
  }, [activityByFilter, activitySearch]);

  const visibleActivity = useMemo(
    () => searchedActivity.slice(0, activityVisibleCount),
    [activityVisibleCount, searchedActivity],
  );

  const groupedVisibleActivity = useMemo(() => {
    const groups = new Map<string, ActivityEntry[]>();
    for (const entry of visibleActivity) {
      const label = dayLabel(entry.timestamp);
      groups.set(label, [...(groups.get(label) ?? []), entry]);
    }
    return Array.from(groups.entries());
  }, [visibleActivity]);

  const takeoffGroupsByKey = useMemo(() => {
    return new Map(takeoffGroups.map((group) => [group.key, group]));
  }, [takeoffGroups]);

  const groupedTakeoffItems = useMemo(() => {
    const grouped = new Map<string, TakeoffItem[]>();

    for (const item of takeoffItems) {
      const key = buildTakeoffGroupKey(item.location);
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }

    return Array.from(grouped.entries())
      .map(([key, items]) => {
        const group = takeoffGroupsByKey.get(key);
        const title = group?.name || (key === "unassigned" ? "Unassigned" : items[0]?.location || "Unassigned");
        const totals = summarizeTakeoffByUnit(items);

        return {
          key,
          title,
          collapsed: group?.collapsed === true,
          items: items.sort((a, b) => a.name.localeCompare(b.name)),
          totals,
        };
      })
      .sort((a, b) => {
        if (a.key === "unassigned") return 1;
        if (b.key === "unassigned") return -1;
        return a.title.localeCompare(b.title);
      });
  }, [takeoffGroupsByKey, takeoffItems]);

  const projectTakeoffTotals = useMemo(() => summarizeTakeoffByUnit(takeoffItems), [takeoffItems]);

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
      [`dimcan:projectTakeoffItems:${fromName}`, `dimcan:projectTakeoffItems:${toName}`],
      [`dimcan:projectTakeoffGroups:${fromName}`, `dimcan:projectTakeoffGroups:${toName}`],
      [`dimcan:projectTakeoffSettings:${fromName}`, `dimcan:projectTakeoffSettings:${toName}`],
      [`dimcan:projectPricingSettings:${fromName}`, `dimcan:projectPricingSettings:${toName}`],
      [`dimcan:projectPricingAdjustments:${fromName}`, `dimcan:projectPricingAdjustments:${toName}`],
      [`dimcan:projectPricingSummary:${fromName}`, `dimcan:projectPricingSummary:${toName}`],
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
    const localAssembliesRaw = readStorageValue<unknown[]>(assemblyStorageKey, []);
    const localAssemblies = normalizeAssemblies(localAssembliesRaw);
    const localTakeoffSettingsRaw = readStorageValue<unknown>(takeoffSettingsStorageKey, defaultTakeoffSettings());
    const localTakeoffSettings = normalizeTakeoffSettings(localTakeoffSettingsRaw);
    const localTakeoffItemsRaw = readStorageValue<unknown[]>(takeoffItemsStorageKey, []);
    const localTakeoffItems = normalizeTakeoffItems(localTakeoffItemsRaw, localTakeoffSettings);
    const localTakeoffGroupsRaw = readStorageValue<unknown[]>(takeoffGroupsStorageKey, []);
    const localTakeoffGroups = syncTakeoffGroupsWithItems(
      localTakeoffItems,
      normalizeTakeoffGroups(localTakeoffGroupsRaw),
    );
    const localPricingSettings = normalizePricingSettings(
      readStorageValue<unknown>(pricingSettingsStorageKey, createDefaultPricingSettings()),
    );
    const localPricingAdjustments = normalizePricingAdjustments(
      readStorageValue<unknown[]>(pricingAdjustmentsStorageKey, []),
    );
    const localPricingSummary = normalizePricingSummary(
      readStorageValue<unknown>(pricingSummaryStorageKey, null),
    );
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
      takeoffItems: localTakeoffItems,
      takeoffGroups: localTakeoffGroups,
      takeoffSettings: localTakeoffSettings,
      pricingSettings: localPricingSettings,
      pricingAdjustments: localPricingAdjustments,
      pricingSummary: localPricingSummary,
      understandingOverrides: localUnderstanding,
      attributionData: localAttribution,
    };

    const hasData =
      localDisplayTitle.trim() !== "" && localDisplayTitle !== projectName
        ? true
        : normalizedLocalNotes.length > 0 ||
          normalizedLocalActivity.length > 0 ||
          localAssemblies.length > 0 ||
          localTakeoffItems.length > 0 ||
          localPricingAdjustments.length > 0 ||
          Object.keys(localUnderstanding).length > 0 ||
          Object.keys(localAttribution).length > 0;

    return {
      patch,
      hasData,
    };
  }, [
    activityStorageKey,
    assemblyStorageKey,
    attrStorageKey,
    notesStorageKey,
    pricingAdjustmentsStorageKey,
    pricingSettingsStorageKey,
    pricingSummaryStorageKey,
    projectName,
    storageKey,
    takeoffGroupsStorageKey,
    takeoffItemsStorageKey,
    takeoffSettingsStorageKey,
    titleStorageKey,
  ]);

  const applyProjectData = useCallback((project: PersistedProjectData) => {
    const safeTitle = (project.displayTitle || projectName).trim() || projectName;

    setProjectTitle(safeTitle);
    setTitleDraft(safeTitle);
    setProjectNotes(Array.isArray(project.notes) ? project.notes : []);
    setActivity(Array.isArray(project.activity) ? project.activity : []);
    setAssembliesState(normalizeAssemblies(project.assemblies));
    const normalizedTakeoffSettings = normalizeTakeoffSettings(project.takeoffSettings);
    const normalizedTakeoffItems = normalizeTakeoffItems(project.takeoffItems, normalizedTakeoffSettings);
    setTakeoffSettings(normalizedTakeoffSettings);
    setTakeoffItems(normalizedTakeoffItems);
    setTakeoffGroups(syncTakeoffGroupsWithItems(normalizedTakeoffItems, normalizeTakeoffGroups(project.takeoffGroups)));
    setPricingSettings(normalizePricingSettings(project.pricingSettings));
    setPricingAdjustments(normalizePricingAdjustments(project.pricingAdjustments));
    setPersistedPricingSummary(normalizePricingSummary(project.pricingSummary));
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

  const saveProjectPatch = useCallback((patch: ProjectDataPatch) => {
    const runSave = async () => {
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
        return true;
      } catch {
        setSaveStatusWithTimeout("error");
        return false;
      }
    };

    const queued = saveQueueRef.current.then(runSave, runSave);
    saveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [projectName, setSaveStatusWithTimeout]);

  const loadProjectData = useCallback(async () => {
    setIsProjectDataLoading(true);
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

      const normalizedProject = {
        ...effectiveProject,
        assemblies: normalizeAssemblies(effectiveProject.assemblies),
        takeoffSettings: normalizeTakeoffSettings(effectiveProject.takeoffSettings),
        pricingSettings: normalizePricingSettings(effectiveProject.pricingSettings),
        pricingAdjustments: normalizePricingAdjustments(effectiveProject.pricingAdjustments),
        pricingSummary: normalizePricingSummary(effectiveProject.pricingSummary),
      };
      const normalizedTakeoffItems = normalizeTakeoffItems(
        effectiveProject.takeoffItems,
        normalizedProject.takeoffSettings,
      );
      const normalizedTakeoffGroups = syncTakeoffGroupsWithItems(
        normalizedTakeoffItems,
        normalizeTakeoffGroups(effectiveProject.takeoffGroups),
      );

      normalizedProject.takeoffItems = normalizedTakeoffItems;
      normalizedProject.takeoffGroups = normalizedTakeoffGroups;

      applyProjectData(normalizedProject);
      writeStorageValue(titleStorageKey, normalizedProject.displayTitle);
      writeStorageValue(notesStorageKey, normalizedProject.notes);
      writeStorageValue(activityStorageKey, normalizedProject.activity);
      writeStorageValue(assemblyStorageKey, normalizedProject.assemblies);
      writeStorageValue(takeoffItemsStorageKey, normalizedProject.takeoffItems);
      writeStorageValue(takeoffGroupsStorageKey, normalizedProject.takeoffGroups);
      writeStorageValue(takeoffSettingsStorageKey, normalizedProject.takeoffSettings);
      writeStorageValue(pricingSettingsStorageKey, normalizedProject.pricingSettings);
      writeStorageValue(pricingAdjustmentsStorageKey, normalizedProject.pricingAdjustments);
      writeStorageValue(pricingSummaryStorageKey, normalizedProject.pricingSummary);
      writeStorageValue(storageKey, normalizedProject.understandingOverrides);
      writeStorageValue(attrStorageKey, normalizedProject.attributionData);
    } catch {
      const fallbackLocal = getLocalFallbackProjectData();
      applyProjectData({
        schemaVersion: 2,
        displayTitle: fallbackLocal.patch.displayTitle || projectName,
        notes: fallbackLocal.patch.notes || [],
        activity: fallbackLocal.patch.activity || [],
        assemblies: fallbackLocal.patch.assemblies || [],
        takeoffItems: fallbackLocal.patch.takeoffItems || [],
        takeoffGroups: fallbackLocal.patch.takeoffGroups || [],
        takeoffSettings: fallbackLocal.patch.takeoffSettings || defaultTakeoffSettings(),
        pricingSettings: fallbackLocal.patch.pricingSettings || createDefaultPricingSettings(),
        pricingAdjustments: fallbackLocal.patch.pricingAdjustments || [],
        pricingSummary: fallbackLocal.patch.pricingSummary || buildProjectPricingSummary({
          assemblies: normalizeAssemblies(fallbackLocal.patch.assemblies || []),
          takeoffItems: fallbackLocal.patch.takeoffItems || [],
          pricingSettings: normalizePricingSettings(fallbackLocal.patch.pricingSettings || createDefaultPricingSettings()),
          pricingAdjustments: normalizePricingAdjustments(fallbackLocal.patch.pricingAdjustments || []),
        }),
        understandingOverrides: fallbackLocal.patch.understandingOverrides || {},
        attributionData: fallbackLocal.patch.attributionData || {},
        updatedAt: new Date().toISOString(),
      });
      setSaveStatus("error");
    } finally {
      setIsProjectDataLoading(false);
    }
  }, [
    activityStorageKey,
    applyProjectData,
    assemblyStorageKey,
    attrStorageKey,
    getLocalFallbackProjectData,
    migrationKey,
    notesStorageKey,
    pricingAdjustmentsStorageKey,
    pricingSettingsStorageKey,
    pricingSummaryStorageKey,
    projectName,
    storageKey,
    takeoffGroupsStorageKey,
    takeoffItemsStorageKey,
    takeoffSettingsStorageKey,
    titleStorageKey,
  ]);

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

  const persistAssemblies = useCallback((next: ProjectAssemblyRecord[], mode: "debounced" | "immediate" = "debounced") => {
    setAssembliesState(next);
    writeStorageValue(assemblyStorageKey, next);

    if (assemblySaveTimerRef.current) {
      window.clearTimeout(assemblySaveTimerRef.current);
      assemblySaveTimerRef.current = null;
    }

    if (mode === "immediate") {
      void saveProjectPatch({ assemblies: next });
      return;
    }

    assemblySaveTimerRef.current = window.setTimeout(() => {
      void saveProjectPatch({ assemblies: next });
      assemblySaveTimerRef.current = null;
    }, 450) as unknown as number;
  }, [assemblyStorageKey, saveProjectPatch]);

  const createAssembly = useCallback((assembly: ProjectAssemblyRecord) => {
    const next = [assembly, ...assembliesState];
    persistAssemblies(next, "immediate");
    appendActivity({
      type: "assembly-added",
      title: "Assembly created",
      description: `${assembly.name} created in ${assembly.category}.`,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { assemblyId: assembly.id, category: assembly.category },
    });
  }, [appendActivity, assembliesState, persistAssemblies]);

  const importAssembliesFromLibrary = useCallback((importedAssemblies: ProjectAssemblyRecord[], sourceTemplates: AssemblyLibraryTemplate[]) => {
    if (importedAssemblies.length === 0) {
      return;
    }

    const next = [...importedAssemblies, ...assembliesState];
    persistAssemblies(next, "immediate");

    const sourceNames = sourceTemplates.map((template) => template.name).slice(0, 3).join(", ");
    appendActivity({
      type: "assembly-added",
      title: importedAssemblies.length === 1 ? "Assembly imported from library" : "Assemblies imported from library",
      description: importedAssemblies.length === 1
        ? `${importedAssemblies[0].name} imported from Assembly Library.`
        : `${importedAssemblies.length} assemblies imported from Assembly Library${sourceNames ? ` (${sourceNames}${sourceTemplates.length > 3 ? ", ..." : ""})` : ""}.`,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: {
        importedAssemblyIds: importedAssemblies.map((assembly) => assembly.id),
        sourceTemplateIds: sourceTemplates.map((template) => template.id),
      },
    });
  }, [appendActivity, assembliesState, persistAssemblies]);

  const duplicateAssembly = useCallback((assemblyId: string) => {
    const source = assembliesState.find((item) => item.id === assemblyId);
    if (!source) {
      return;
    }

    const nextCopy = cloneAssembly(source);
    const next = [nextCopy, ...assembliesState];
    persistAssemblies(next, "immediate");
    appendActivity({
      type: "assembly-added",
      title: "Assembly duplicated",
      description: `${source.name} duplicated as ${nextCopy.name}.`,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { sourceAssemblyId: source.id, duplicatedAssemblyId: nextCopy.id },
    });
  }, [appendActivity, assembliesState, persistAssemblies]);

  const deleteAssembly = useCallback((assemblyId: string) => {
    const source = assembliesState.find((item) => item.id === assemblyId);
    const next = assembliesState.filter((item) => item.id !== assemblyId);
    persistAssemblies(next, "immediate");

    if (source) {
      appendActivity({
        type: "assembly-removed",
        title: "Assembly deleted",
        description: `${source.name} was removed.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: { assemblyId: source.id },
      });
    }
  }, [appendActivity, assembliesState, persistAssemblies]);

  const autosaveAssemblyEdit = useCallback((assembly: ProjectAssemblyRecord, logActivity: boolean) => {
    const next = assembliesState.map((item) => item.id === assembly.id ? assembly : item);
    persistAssemblies(next, "debounced");

    if (logActivity) {
      appendActivity({
        type: "assembly-edited",
        title: "Assembly updated",
        description: `${assembly.name} was updated.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: { assemblyId: assembly.id },
      });
    }
  }, [appendActivity, assembliesState, persistAssemblies]);

  const persistTakeoffSnapshot = useCallback((
    nextItems: TakeoffItem[],
    nextGroups: TakeoffGroup[],
    nextSettings: TakeoffSettings,
    mode: "debounced" | "immediate" = "debounced",
  ) => {
    setTakeoffItems(nextItems);
    setTakeoffGroups(nextGroups);
    setTakeoffSettings(nextSettings);

    writeStorageValue(takeoffItemsStorageKey, nextItems);
    writeStorageValue(takeoffGroupsStorageKey, nextGroups);
    writeStorageValue(takeoffSettingsStorageKey, nextSettings);

    if (takeoffSaveTimerRef.current) {
      window.clearTimeout(takeoffSaveTimerRef.current);
      takeoffSaveTimerRef.current = null;
    }

    if (mode === "immediate") {
      void saveProjectPatch({
        takeoffItems: nextItems,
        takeoffGroups: nextGroups,
        takeoffSettings: nextSettings,
      }).then((success) => {
        if (!success) {
          setTakeoffUiMessage("Could not save takeoff changes. Please retry.");
        }
      });
      return;
    }

    takeoffSaveTimerRef.current = window.setTimeout(() => {
      void saveProjectPatch({
        takeoffItems: nextItems,
        takeoffGroups: nextGroups,
        takeoffSettings: nextSettings,
      }).then((success) => {
        if (!success) {
          setTakeoffUiMessage("Could not save takeoff changes. Please retry.");
        }
      });
      takeoffSaveTimerRef.current = null;
    }, 450) as unknown as number;
  }, [saveProjectPatch, takeoffGroupsStorageKey, takeoffItemsStorageKey, takeoffSettingsStorageKey]);

  const updateAssembliesFromTakeoffLinks = useCallback((
    previousItem: TakeoffItem | null,
    nextItem: TakeoffItem,
    reason: "created" | "edited" | "duplicated",
  ) => {
    const previousLinked = new Set(previousItem?.linkedAssemblyIds ?? []);
    const nextLinked = new Set(nextItem.linkedAssemblyIds);

    const newlyLinked = Array.from(nextLinked).filter((id) => !previousLinked.has(id));
    const removedLinks = Array.from(previousLinked).filter((id) => !nextLinked.has(id));

    let nextAssemblies = assembliesState;
    let assembliesChanged = false;
    const resolvedLinked = new Set<string>(nextItem.linkedAssemblyIds);
    const unlinkNameList: string[] = [];
    const linkNameList: string[] = [];

    for (const assemblyId of newlyLinked) {
      const target = nextAssemblies.find((assembly) => assembly.id === assemblyId);
      if (!target) {
        resolvedLinked.delete(assemblyId);
        continue;
      }

      if (target.takeoffControl?.takeoffItemId && target.takeoffControl.takeoffItemId !== nextItem.id) {
        const shouldReassign = window.confirm(
          `${target.name} is already controlled by another takeoff item. Reassign control to ${nextItem.name}?`,
        );
        if (!shouldReassign) {
          resolvedLinked.delete(assemblyId);
          continue;
        }
      }

      if (!target.takeoffControl?.takeoffItemId && Math.abs(target.quantity - nextItem.calculatedQuantity) > 0.0001) {
        const shouldOverwrite = window.confirm(
          `Linking ${target.name} will set its quantity from ${target.quantity} to ${nextItem.calculatedQuantity}. Continue?`,
        );
        if (!shouldOverwrite) {
          resolvedLinked.delete(assemblyId);
          continue;
        }
      }

      linkNameList.push(target.name);
      assembliesChanged = true;
      nextAssemblies = nextAssemblies.map((assembly) => (
        assembly.id === assemblyId
          ? {
              ...assembly,
              quantity: nextItem.calculatedQuantity,
              takeoffControl: {
                takeoffItemId: nextItem.id,
                takeoffItemName: nextItem.name,
                unit: nextItem.unit,
                linkedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            }
          : assembly
      ));
    }

    for (const assemblyId of removedLinks) {
      const target = nextAssemblies.find((assembly) => assembly.id === assemblyId);
      if (!target) {
        continue;
      }
      unlinkNameList.push(target.name);
      assembliesChanged = true;
      nextAssemblies = nextAssemblies.map((assembly) => (
        assembly.id === assemblyId
          ? {
              ...assembly,
              takeoffControl: undefined,
              updatedAt: new Date().toISOString(),
            }
          : assembly
      ));
    }

    // Keep linked assemblies synchronized for this item.
    nextAssemblies = nextAssemblies.map((assembly) => {
      if (assembly.takeoffControl?.takeoffItemId !== nextItem.id) {
        return assembly;
      }

      const shouldUpdate =
        Math.abs(assembly.quantity - nextItem.calculatedQuantity) > 0.0001 ||
        assembly.takeoffControl.takeoffItemName !== nextItem.name ||
        assembly.takeoffControl.unit !== nextItem.unit;

      if (!shouldUpdate) {
        return assembly;
      }

      assembliesChanged = true;
      return {
        ...assembly,
        quantity: nextItem.calculatedQuantity,
        takeoffControl: {
          ...assembly.takeoffControl,
          takeoffItemName: nextItem.name,
          unit: nextItem.unit,
        },
        updatedAt: new Date().toISOString(),
      };
    });

    if (assembliesChanged) {
      persistAssemblies(nextAssemblies, "immediate");
    }

    const finalLinkedIds = Array.from(resolvedLinked);
    const normalizedItem = { ...nextItem, linkedAssemblyIds: finalLinkedIds };

    if (linkNameList.length > 0) {
      appendActivity({
        type: "takeoff-linked",
        title: "Takeoff linked to assemblies",
        description: `${normalizedItem.name} linked to ${linkNameList.length} assembly${linkNameList.length === 1 ? "" : "ies"}.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: {
          takeoffItemId: normalizedItem.id,
          assemblyNames: linkNameList,
          trigger: reason,
        },
      });
    }

    if (unlinkNameList.length > 0) {
      appendActivity({
        type: "takeoff-unlinked",
        title: "Takeoff unlinked from assemblies",
        description: `${normalizedItem.name} unlinked from ${unlinkNameList.length} assembly${unlinkNameList.length === 1 ? "" : "ies"}.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: {
          takeoffItemId: normalizedItem.id,
          assemblyNames: unlinkNameList,
          trigger: reason,
        },
      });
    }

    return normalizedItem;
  }, [appendActivity, assembliesState, persistAssemblies]);

  const openTakeoffCreate = () => {
    setTakeoffDraft(createEmptyTakeoffItem(takeoffSettings));
    setTakeoffEditorItemId(null);
    setTakeoffValidationError(null);
    setTakeoffUiMessage(null);
  };

  const openTakeoffEdit = (itemId: string) => {
    const item = takeoffItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    setTakeoffDraft({ ...item });
    setTakeoffEditorItemId(itemId);
    setTakeoffValidationError(null);
    setTakeoffUiMessage(null);
  };

  const closeTakeoffEditor = () => {
    setTakeoffDraft(null);
    setTakeoffEditorItemId(null);
    setTakeoffValidationError(null);
  };

  const saveTakeoffDraft = () => {
    if (!takeoffDraft) {
      return;
    }

    const trimmedName = takeoffDraft.name.trim();
    if (!trimmedName) {
      setTakeoffValidationError("Item name is required.");
      return;
    }

    const updated = withUpdatedTakeoffItem({
      ...takeoffDraft,
      name: trimmedName,
      sourceFile: takeoffDraft.sourceType === "manual" ? "" : takeoffDraft.sourceFile,
    });

    const previousItem = takeoffEditorItemId
      ? takeoffItems.find((item) => item.id === takeoffEditorItemId) ?? null
      : null;
    const linkedResult = updateAssembliesFromTakeoffLinks(previousItem, updated, previousItem ? "edited" : "created");
    const nextItem = linkedResult ?? updated;

    const baseItems = previousItem
      ? takeoffItems.map((item) => (item.id === previousItem.id ? nextItem : item))
      : [nextItem, ...takeoffItems];
    const nextGroups = syncTakeoffGroupsWithItems(baseItems, takeoffGroups);

    persistTakeoffSnapshot(baseItems, nextGroups, takeoffSettings, "immediate");

    if (!previousItem) {
      appendActivity({
        type: "takeoff-created",
        title: "Takeoff item created",
        description: `${nextItem.name} added in ${nextItem.location || "Unassigned"}.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: { takeoffItemId: nextItem.id, unit: nextItem.unit, quantity: nextItem.calculatedQuantity },
      });
    } else {
      const prevSnapshot = JSON.stringify({
        name: previousItem.name,
        category: previousItem.category,
        location: previousItem.location,
        quantity: previousItem.quantity,
        length: previousItem.length,
        width: previousItem.width,
        height: previousItem.height,
        deduction: previousItem.deduction,
        wastePercent: previousItem.wastePercent,
        calculatedQuantity: previousItem.calculatedQuantity,
        notes: previousItem.notes,
        sourceType: previousItem.sourceType,
        sourceFile: previousItem.sourceFile,
        linkedAssemblyIds: previousItem.linkedAssemblyIds,
      });
      const nextSnapshot = JSON.stringify({
        name: nextItem.name,
        category: nextItem.category,
        location: nextItem.location,
        quantity: nextItem.quantity,
        length: nextItem.length,
        width: nextItem.width,
        height: nextItem.height,
        deduction: nextItem.deduction,
        wastePercent: nextItem.wastePercent,
        calculatedQuantity: nextItem.calculatedQuantity,
        notes: nextItem.notes,
        sourceType: nextItem.sourceType,
        sourceFile: nextItem.sourceFile,
        linkedAssemblyIds: nextItem.linkedAssemblyIds,
      });

      if (prevSnapshot !== nextSnapshot) {
        appendActivity({
          type: "takeoff-edited",
          title: "Takeoff item updated",
          description: `${nextItem.name} was updated.`,
          source: "user",
          relatedFile: null,
          relatedFolder: null,
          metadata: { takeoffItemId: nextItem.id },
        });
      }
    }

    setTakeoffUiMessage(previousItem ? "Takeoff item saved." : "Takeoff item created.");
    closeTakeoffEditor();
  };

  const duplicateTakeoffItem = (itemId: string) => {
    const source = takeoffItems.find((entry) => entry.id === itemId);
    if (!source) {
      return;
    }

    const now = new Date().toISOString();
    const duplicated = withUpdatedTakeoffItem({
      ...source,
      id: makeId(),
      name: `${source.name} (Copy)`,
      linkedAssemblyIds: [],
      createdAt: now,
      updatedAt: now,
    });

    const nextItems = [duplicated, ...takeoffItems];
    const nextGroups = syncTakeoffGroupsWithItems(nextItems, takeoffGroups);
    persistTakeoffSnapshot(nextItems, nextGroups, takeoffSettings, "immediate");

    appendActivity({
      type: "takeoff-duplicated",
      title: "Takeoff item duplicated",
      description: `${source.name} duplicated as ${duplicated.name}.`,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { takeoffItemId: duplicated.id, sourceTakeoffItemId: source.id },
    });

    setTakeoffUiMessage("Takeoff item duplicated.");
    setOpenTakeoffMenuId(null);
  };

  const deleteTakeoffItem = (itemId: string) => {
    const source = takeoffItems.find((entry) => entry.id === itemId);
    if (!source) {
      return;
    }

    if (!window.confirm(`Delete takeoff item "${source.name}"?`)) {
      return;
    }

    if (source.linkedAssemblyIds.length > 0) {
      const shouldUnlink = window.confirm(
        `${source.linkedAssemblyIds.length} linked assembly quantity control(s) will be removed while keeping current assembly quantities. Continue?`,
      );
      if (!shouldUnlink) {
        return;
      }
    }

    let nextAssemblies = assembliesState;
    for (const assemblyId of source.linkedAssemblyIds) {
      nextAssemblies = nextAssemblies.map((assembly) => (
        assembly.id === assemblyId && assembly.takeoffControl?.takeoffItemId === source.id
          ? { ...assembly, takeoffControl: undefined, updatedAt: new Date().toISOString() }
          : assembly
      ));
    }
    if (nextAssemblies !== assembliesState) {
      persistAssemblies(nextAssemblies, "immediate");
      appendActivity({
        type: "takeoff-unlinked",
        title: "Takeoff unlinked from assemblies",
        description: `${source.name} unlinked from ${source.linkedAssemblyIds.length} assembly${source.linkedAssemblyIds.length === 1 ? "" : "ies"}.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: { takeoffItemId: source.id, assemblyIds: source.linkedAssemblyIds },
      });
    }

    const nextItems = takeoffItems.filter((entry) => entry.id !== itemId);
    const nextGroups = syncTakeoffGroupsWithItems(nextItems, takeoffGroups);
    persistTakeoffSnapshot(nextItems, nextGroups, takeoffSettings, "immediate");

    appendActivity({
      type: "takeoff-deleted",
      title: "Takeoff item deleted",
      description: `${source.name} was removed.`,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata: { takeoffItemId: source.id },
    });

    setOpenTakeoffMenuId(null);
    setTakeoffUiMessage("Takeoff item deleted.");
  };

  const toggleTakeoffGroupCollapse = (groupKey: string) => {
    const now = new Date().toISOString();
    const existing = takeoffGroups.find((group) => group.key === groupKey);
    const nextGroups = existing
      ? takeoffGroups.map((group) => group.key === groupKey ? { ...group, collapsed: !group.collapsed, updatedAt: now } : group)
      : syncTakeoffGroupsWithItems(takeoffItems, takeoffGroups).map((group) => group.key === groupKey ? { ...group, collapsed: true, updatedAt: now } : group);

    persistTakeoffSnapshot(takeoffItems, nextGroups, takeoffSettings, "immediate");
  };

  const updateTakeoffSettings = (patch: Partial<TakeoffSettings>) => {
    const nextSettings = normalizeTakeoffSettings({ ...takeoffSettings, ...patch });
    const nextItems = [...takeoffItems];
    const nextGroups = syncTakeoffGroupsWithItems(nextItems, takeoffGroups);
    persistTakeoffSnapshot(nextItems, nextGroups, nextSettings, "immediate");
  };

  const sourceTypeFolderMap: Record<TakeoffSourceType, ProjectFolder | null> = {
    manual: null,
    drawing: "Drawings",
    photo: "Photos",
    note: "Notes",
    document: "Documents",
  };

  const updateTakeoffDraftField = <K extends keyof TakeoffItem>(field: K, value: TakeoffItem[K]) => {
    setTakeoffDraft((current) => {
      if (!current) {
        return current;
      }

      const draftBase = {
        ...current,
        [field]: value,
      };

      const withSource = field === "sourceType" && value === "manual"
        ? { ...draftBase, sourceFile: "" }
        : draftBase;

      return withUpdatedTakeoffItem(withSource);
    });
  };

  const openTakeoffSourcePreview = (item: TakeoffItem) => {
    const sourceFolder = sourceTypeFolderMap[item.sourceType];
    if (!sourceFolder || !item.sourceFile) {
      return;
    }

    const file = projectFiles.find((entry) => entry.folder === sourceFolder && entry.filename === item.sourceFile);
    if (!file) {
      return;
    }

    setFileActionError(null);
    openProjectFile(file, "preview", false);
  };

  const computedPricingSummary = useMemo(() => {
    return buildProjectPricingSummary({
      assemblies: assembliesState,
      takeoffItems,
      pricingSettings,
      pricingAdjustments,
    });
  }, [assembliesState, pricingAdjustments, pricingSettings, takeoffItems]);

  const setPricingMessageWithTimeout = useCallback((message: string | null) => {
    setPricingMessage(message);
    if (pricingMessageTimerRef.current) {
      window.clearTimeout(pricingMessageTimerRef.current);
      pricingMessageTimerRef.current = null;
    }
    if (message) {
      pricingMessageTimerRef.current = window.setTimeout(() => {
        setPricingMessage(null);
        pricingMessageTimerRef.current = null;
      }, 1800) as unknown as number;
    }
  }, []);

  const persistPricingData = useCallback(async (
    nextSettings: PricingSettings,
    nextAdjustments: PricingAdjustment[],
    options?: {
      message?: string;
      activity?: {
        type: "pricing-settings-updated" | "pricing-adjustment-updated";
        title: string;
        description: string;
        metadata: Record<string, unknown>;
      };
    },
  ) => {
    const normalizedSettings = normalizePricingSettings(nextSettings);
    const normalizedAdjustments = normalizePricingAdjustments(nextAdjustments);
    const summary = buildProjectPricingSummary({
      assemblies: assembliesState,
      takeoffItems,
      pricingSettings: normalizedSettings,
      pricingAdjustments: normalizedAdjustments,
    });

    setPricingSettings(normalizedSettings);
    setPricingAdjustments(normalizedAdjustments);
    setPersistedPricingSummary(summary);

    writeStorageValue(pricingSettingsStorageKey, normalizedSettings);
    writeStorageValue(pricingAdjustmentsStorageKey, normalizedAdjustments);
    writeStorageValue(pricingSummaryStorageKey, summary);

    const success = await saveProjectPatch({
      pricingSettings: normalizedSettings,
      pricingAdjustments: normalizedAdjustments,
      pricingSummary: summary,
    });

    if (!success) {
      setPricingError("Could not save pricing updates. Please retry.");
      return;
    }

    setPricingError(null);
    if (options?.message) {
      setPricingMessageWithTimeout(options.message);
    }

    if (options?.activity) {
      appendActivity({
        type: options.activity.type,
        title: options.activity.title,
        description: options.activity.description,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: options.activity.metadata,
      });
    }
  }, [
    appendActivity,
    assembliesState,
    pricingAdjustmentsStorageKey,
    pricingSettingsStorageKey,
    pricingSummaryStorageKey,
    saveProjectPatch,
    setPricingMessageWithTimeout,
    takeoffItems,
  ]);

  const updatePricingSettings = useCallback((patch: Partial<PricingSettings>, logActivity = false) => {
    const nextSettings = normalizePricingSettings({ ...pricingSettings, ...patch });
    if (JSON.stringify(nextSettings) === JSON.stringify(pricingSettings)) {
      return;
    }
    void persistPricingData(nextSettings, pricingAdjustments, {
      message: "Pricing settings saved.",
      activity: logActivity
        ? {
            type: "pricing-settings-updated",
            title: "Pricing settings updated",
            description: "Project-level tax and pricing settings were updated.",
            metadata: {
              pstEnabled: nextSettings.pstEnabled,
              gstEnabled: nextSettings.gstEnabled,
              pstRate: nextSettings.pstRate,
              gstRate: nextSettings.gstRate,
            },
          }
        : undefined,
    });
  }, [persistPricingData, pricingAdjustments, pricingSettings]);

  const logPricingSettingsActivity = useCallback((description: string, metadata: Record<string, unknown>) => {
    appendActivity({
      type: "pricing-settings-updated",
      title: "Pricing settings updated",
      description,
      source: "user",
      relatedFile: null,
      relatedFolder: null,
      metadata,
    });
  }, [appendActivity]);

  const openCreatePricingAdjustment = () => {
    setEditingAdjustmentId(null);
    setPricingAdjustmentDraft(createDefaultPricingAdjustment());
    setIsPricingAdjustmentEditorOpen(true);
    setPricingError(null);
  };

  const openEditPricingAdjustment = (adjustmentId: string) => {
    const existing = pricingAdjustments.find((entry) => entry.id === adjustmentId);
    if (!existing) {
      return;
    }
    setEditingAdjustmentId(adjustmentId);
    setPricingAdjustmentDraft(existing);
    setIsPricingAdjustmentEditorOpen(true);
    setPricingError(null);
    setOpenPricingAdjustmentMenuId(null);
  };

  const closePricingAdjustmentEditor = () => {
    setIsPricingAdjustmentEditorOpen(false);
    setEditingAdjustmentId(null);
    setPricingAdjustmentDraft(createDefaultPricingAdjustment());
  };

  const savePricingAdjustmentDraft = async () => {
    const name = pricingAdjustmentDraft.name.trim();
    if (!name) {
      setPricingError("Adjustment name is required.");
      return;
    }

    const normalizedDraft: PricingAdjustment = {
      ...pricingAdjustmentDraft,
      name,
      value: Math.max(0, Number.isFinite(pricingAdjustmentDraft.value) ? pricingAdjustmentDraft.value : 0),
      notes: pricingAdjustmentDraft.notes.trim(),
    };

    const nextAdjustments = editingAdjustmentId
      ? pricingAdjustments.map((entry) => entry.id === editingAdjustmentId ? normalizedDraft : entry)
      : [normalizedDraft, ...pricingAdjustments];

    await persistPricingData(pricingSettings, nextAdjustments, {
      message: editingAdjustmentId ? "Adjustment saved." : "Adjustment added.",
      activity: {
        type: "pricing-adjustment-updated",
        title: editingAdjustmentId ? "Pricing adjustment updated" : "Pricing adjustment added",
        description: `${normalizedDraft.name} ${editingAdjustmentId ? "was updated" : "was added"}.`,
        metadata: {
          adjustmentId: normalizedDraft.id,
          type: normalizedDraft.type,
          amountType: normalizedDraft.amountType,
          value: normalizedDraft.value,
        },
      },
    });

    setPricingError(null);
    closePricingAdjustmentEditor();
  };

  const togglePricingAdjustmentEnabled = async (adjustmentId: string) => {
    const existing = pricingAdjustments.find((entry) => entry.id === adjustmentId);
    if (!existing) {
      return;
    }

    const nextAdjustments = pricingAdjustments.map((entry) => (
      entry.id === adjustmentId ? { ...entry, enabled: !entry.enabled } : entry
    ));

    await persistPricingData(pricingSettings, nextAdjustments, {
      message: existing.enabled ? "Adjustment disabled." : "Adjustment enabled.",
      activity: {
        type: "pricing-adjustment-updated",
        title: "Pricing adjustment toggled",
        description: `${existing.name} was ${existing.enabled ? "disabled" : "enabled"}.`,
        metadata: { adjustmentId: existing.id, enabled: !existing.enabled },
      },
    });
  };

  const duplicatePricingAdjustmentById = async (adjustmentId: string) => {
    const existing = pricingAdjustments.find((entry) => entry.id === adjustmentId);
    if (!existing) {
      return;
    }

    const duplicated = duplicatePricingAdjustment(existing);
    const nextAdjustments = [duplicated, ...pricingAdjustments];

    await persistPricingData(pricingSettings, nextAdjustments, {
      message: "Adjustment duplicated.",
      activity: {
        type: "pricing-adjustment-updated",
        title: "Pricing adjustment duplicated",
        description: `${existing.name} duplicated as ${duplicated.name}.`,
        metadata: { sourceAdjustmentId: existing.id, duplicatedAdjustmentId: duplicated.id },
      },
    });

    setOpenPricingAdjustmentMenuId(null);
  };

  const deletePricingAdjustmentById = async (adjustmentId: string) => {
    const existing = pricingAdjustments.find((entry) => entry.id === adjustmentId);
    if (!existing) {
      return;
    }

    if (!window.confirm(`Delete pricing adjustment \"${existing.name}\"?`)) {
      return;
    }

    const nextAdjustments = pricingAdjustments.filter((entry) => entry.id !== adjustmentId);
    await persistPricingData(pricingSettings, nextAdjustments, {
      message: "Adjustment deleted.",
      activity: {
        type: "pricing-adjustment-updated",
        title: "Pricing adjustment deleted",
        description: `${existing.name} was deleted.`,
        metadata: { adjustmentId: existing.id },
      },
    });

    setOpenPricingAdjustmentMenuId(null);
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
      assemblies: assembliesState.map((item) => ({ assembly: { name: item.name }, sourceAssemblyId: item.id })),
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
    const readStage = () => {
      const urlStage = new URLSearchParams(window.location.search).get("stage");
      const rememberedStage = window.localStorage.getItem(stageStorageKey);
      const nextStage = isProjectStage(urlStage)
        ? urlStage
        : isProjectStage(rememberedStage)
          ? rememberedStage
          : "overview";
      setActiveStage(nextStage);
      window.requestAnimationFrame(() => window.scrollTo({ top: stageScrollPositionsRef.current[nextStage] ?? 0 }));
    };

    readStage();
    window.addEventListener("popstate", readStage);
    return () => window.removeEventListener("popstate", readStage);
  }, [stageStorageKey]);

  const navigateToStage = useCallback((stage: ProjectStage, replace = false) => {
    stageScrollPositionsRef.current[activeStage] = window.scrollY;
    setActiveStage(stage);
    setActivityVisibleCount(20);
    window.localStorage.setItem(stageStorageKey, stage);
    const url = new URL(window.location.href);
    url.searchParams.set("stage", stage);
    window.history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.requestAnimationFrame(() => window.scrollTo({ top: stageScrollPositionsRef.current[stage] ?? 0, behavior: "smooth" }));
  }, [activeStage, stageStorageKey]);

  useEffect(() => {
    void loadProjectFiles();
  }, [loadProjectFiles]);

  useEffect(() => {
    return () => {
      if (saveStatusTimerRef.current) {
        window.clearTimeout(saveStatusTimerRef.current);
      }
      if (assemblySaveTimerRef.current) {
        window.clearTimeout(assemblySaveTimerRef.current);
      }
      if (takeoffSaveTimerRef.current) {
        window.clearTimeout(takeoffSaveTimerRef.current);
      }
      if (pricingMessageTimerRef.current) {
        window.clearTimeout(pricingMessageTimerRef.current);
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
    <main className="project-workspace">
      <div className="project-workspace__content">
        <Link href="/" style={{ display: 'inline-block', marginBottom: 18, color: '#766b5d', textDecoration: 'none' }}>← Back to Workspace</Link>

        <header className="project-workspace__header">
          <p style={{ margin: 0, color: '#766b5d', fontSize: 14 }}>Dimcan Project</p>
          {isEditingTitle ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <input ref={titleInputRef} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') void saveTitle(titleDraft); if (e.key==='Escape') cancelTitle(); }} onBlur={() => { void saveTitle(titleDraft); }} style={{ fontSize: 28, fontWeight: 700, padding: '8px 12px', borderRadius: 10, border: '1px solid #d8cdbc' }} />
            </div>
          ) : (
            <h1 onClick={() => { setTitleError(null); setIsEditingTitle(true); }} className="project-workspace__project-title">{projectTitle}</h1>
          )}
          <p style={{ margin: '8px 0 0', color: saveStatus === 'error' ? '#a1260d' : '#9a8f80', fontSize: 12 }}>
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save' : '\u00a0'}
            {computedPricingSummary.hasIncompletePricing ? ` · ${computedPricingSummary.incompleteAssemblies.length} incomplete pricing item${computedPricingSummary.incompleteAssemblies.length === 1 ? "" : "s"}` : ""}
          </p>
          {titleError && (
            <p style={{ margin: '6px 0 0', color: '#a1260d', fontSize: 13 }}>
              {titleError}
            </p>
          )}
          <div className="project-workspace__header-actions">
            <button onClick={() => activeStage === "files" ? openFilePicker() : navigateToStage("files")}>
              {activeStage === "files" ? "Upload files" : "Open files"}
            </button>
            <details>
              <summary aria-label="Project actions">⋯</summary>
              <div>
                <button onClick={() => setIsEditingTitle(true)}>Rename project</button>
                <Link href="/assembly-library">Assembly library</Link>
              </div>
            </details>
          </div>
        </header>

        <nav className="project-workspace__tabs" aria-label="Project stages">
          {PROJECT_STAGES.map((stage) => (
            <button key={stage.id} className={activeStage === stage.id ? "is-active" : ""} aria-current={activeStage === stage.id ? "page" : undefined} onClick={() => navigateToStage(stage.id)}>
              {stage.label}
              {stage.id === "files" && <span>{projectFiles.length}</span>}
              {stage.id === "activity" && <span>{activity.length}</span>}
            </button>
          ))}
        </nav>

        {activeStage === "overview" && (
          <div className="project-overview">
            <div className="project-stage-heading">
              <div><p>Project at a glance</p><h2>Everything important, without the noise.</h2></div>
              <button onClick={() => setIsNotesPanelOpen(true)}>Open notes</button>
            </div>
            {isProjectDataLoading ? (
              <div className="project-skeleton-grid" aria-label="Loading project overview">{Array.from({ length: 6 }, (_, index) => <div key={index} />)}</div>
            ) : (
              <>
                <div className="project-overview__grid">
                  <button className="project-summary-card" onClick={() => navigateToStage("files")}><span>Files</span><strong>{projectFiles.length}</strong><small>{projectFiles.length ? `${fileFilterCounts.Drawings} drawings · ${fileFilterCounts.Photos} photos` : "Upload plans, photos, and documents"}</small><b>View files →</b></button>
                  <button className="project-summary-card" onClick={() => setIsNotesPanelOpen(true)}><span>Notes</span><strong>{projectNotes.length}</strong><small>{projectNotes[0]?.text || "Capture a client request or site decision"}</small><b>Open notes →</b></button>
                  <button className="project-summary-card" onClick={() => navigateToStage("takeoff")}><span>Takeoff</span><strong>{takeoffItems.length}</strong><small>{takeoffItems.length ? `${groupedTakeoffItems.length} measured locations` : "No measurements recorded yet"}</small><b>Open takeoff →</b></button>
                  <button className="project-summary-card" onClick={() => navigateToStage("assemblies")}><span>Assemblies</span><strong>{assembliesState.length}</strong><small>{assembliesState.length ? `${assembliesState.filter((item) => item.takeoffControl).length} linked to takeoff` : "Build reusable scope and costs"}</small><b>View assemblies →</b></button>
                  <button className="project-summary-card project-summary-card--pricing" onClick={() => navigateToStage("pricing")}><span>Pricing</span><strong>{formatCurrency(computedPricingSummary.finalProjectTotal)}</strong><small>{computedPricingSummary.hasIncompletePricing ? `${computedPricingSummary.incompleteAssemblies.length} assemblies need attention` : "Current estimated project total"}</small><b>Review pricing →</b></button>
                  <button className="project-summary-card" onClick={() => navigateToStage("activity")}><span>Activity</span><strong>{activity.length}</strong><small>{activity[0]?.title || "No project history yet"}</small><b>View history →</b></button>
                </div>
                <section className="project-insight">
                  <div><span>AI project understanding</span><h2>{understanding.suggestedProjectName || projectTitle}</h2><p>{understanding.projectContext || "Add project files and notes to build a clearer project understanding."}</p></div>
                  <div className="project-insight__confidence"><strong>{understanding.confidence}%</strong><span>confidence</span></div>
                </section>
              </>
            )}
          </div>
        )}

        {activeStage === "files" && (
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
        )}

        {isNotesPanelOpen && (
        <div className="project-sheet-backdrop" onMouseDown={() => setIsNotesPanelOpen(false)}>
        <section className="project-sheet" onMouseDown={(event) => event.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Project Notes</h2>
            <button className="project-sheet__close" onClick={() => setIsNotesPanelOpen(false)} aria-label="Close notes">×</button>
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
        </div>
        )}

        {activeStage === "takeoff" && (
        <section style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Takeoff</h2>
              <div style={{ marginTop: 6, color: saveStatus === 'error' ? '#a1260d' : '#766b5d', fontSize: 12 }}>
                {isProjectDataLoading ? 'Loading takeoff...' : saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save' : 'Manual takeoff inputs'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={() => updateTakeoffSettings({ showAdvancedFields: !takeoffSettings.showAdvancedFields })}
                style={{ minHeight: 44, border: '1px solid #d8cdbc', background: '#fff', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}
              >
                {takeoffSettings.showAdvancedFields ? 'Hide advanced fields' : 'Show advanced fields'}
              </button>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #d8cdbc', background: '#fff', borderRadius: 8, minHeight: 44, padding: '6px 8px' }}>
                <span style={{ fontSize: 12, color: '#594f43', fontWeight: 700 }}>Default waste %</span>
                <input
                  value={takeoffSettings.defaultWastePercent}
                  onChange={(event) => updateTakeoffSettings({ defaultWastePercent: parseTakeoffNumber(event.target.value, 0) })}
                  inputMode="decimal"
                  style={{ width: 72, minHeight: 34, borderRadius: 6, border: '1px solid #d8cdbc', padding: '6px 8px' }}
                />
              </label>
              <button
                onClick={openTakeoffCreate}
                style={{ minHeight: 44, border: 'none', background: '#594f43', color: '#fff', borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}
              >
                Create item
              </button>
            </div>
          </div>

          {takeoffUiMessage && (
            <div style={{ marginTop: 10, border: '1px solid #c7dec8', background: '#eef9ef', color: '#2f6f42', borderRadius: 8, padding: '10px 12px' }}>
              {takeoffUiMessage}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TAKEOFF_UNITS.map((unit) => (
              <div key={unit} style={{ border: '1px solid #d8cdbc', background: '#fff', borderRadius: 999, padding: '6px 10px', fontSize: 12, color: '#594f43' }}>
                <strong>{unit.toUpperCase()}</strong> net {projectTakeoffTotals[unit].net} • final {projectTakeoffTotals[unit].final}
              </div>
            ))}
          </div>

          {isProjectDataLoading ? (
            <div style={{ marginTop: 12, border: '1px dashed #d8cdbc', borderRadius: 8, padding: 12, color: '#766b5d' }}>
              Loading takeoff data...
            </div>
          ) : takeoffItems.length === 0 ? (
            <div style={{ marginTop: 12, border: '1px dashed #d8cdbc', borderRadius: 8, padding: 12, color: '#766b5d' }}>
              No takeoff items yet. Add measurable areas by room or location, then link them to assemblies to control quantities.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {groupedTakeoffItems.map((group) => (
                <div key={group.key} style={{ border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
                  <button
                    onClick={() => toggleTakeoffGroupCollapse(group.key)}
                    style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid #eee2d3', background: '#fbf5ec', padding: '10px 12px', minHeight: 44, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{group.collapsed ? '▶' : '▼'} {group.title} ({group.items.length})</div>
                      <div style={{ color: '#766b5d', fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {TAKEOFF_UNITS.map((unit) => (
                          <span key={`${group.key}-${unit}`}>{unit}: {group.totals[unit].final}</span>
                        ))}
                      </div>
                    </div>
                  </button>

                  {!group.collapsed && (
                    <div style={{ display: 'grid', gap: 8, padding: 10 }}>
                      {group.items.map((item) => {
                        const quantities = calculateTakeoffQuantities(item);
                        const isExpanded = takeoffExpandedItemId === item.id;
                        const sourceFolder = sourceTypeFolderMap[item.sourceType];
                        const sourceFile = sourceFolder
                          ? projectFiles.find((entry) => entry.folder === sourceFolder && entry.filename === item.sourceFile)
                          : null;
                        const linkedNames = assembliesState
                          .filter((assembly) => item.linkedAssemblyIds.includes(assembly.id))
                          .map((assembly) => assembly.name);

                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setTakeoffExpandedItemId((current) => current === item.id ? null : item.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setTakeoffExpandedItemId((current) => current === item.id ? null : item.id);
                              }
                            }}
                            style={{ border: '1px solid #e6dac8', borderRadius: 10, background: '#fffaf6', padding: 10, cursor: 'pointer' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{item.name}</div>
                                <div style={{ marginTop: 4, color: '#766b5d', fontSize: 13 }}>
                                  {item.category} • {item.location || 'Unassigned'} • {item.calculatedQuantity} {item.unit}
                                </div>
                                <div style={{ marginTop: 4, color: '#594f43', fontSize: 12 }}>
                                  Net {quantities.netQuantity} {item.unit} • Final {item.calculatedQuantity} {item.unit} with {item.wastePercent}% waste
                                </div>
                                <div style={{ marginTop: 4, color: '#8b7f70', fontSize: 12 }}>
                                  Source: {item.sourceType === 'manual' ? 'Manual input' : `${item.sourceType} ${item.sourceFile ? `• ${item.sourceFile}` : ''}`}
                                </div>
                              </div>
                              <div style={{ position: 'relative' }}>
                                <button
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setOpenTakeoffMenuId((current) => current === item.id ? null : item.id);
                                  }}
                                  style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid #d8cdbc', background: '#fff', cursor: 'pointer' }}
                                  aria-label={`Takeoff options for ${item.name}`}
                                >
                                  ⋯
                                </button>
                                {openTakeoffMenuId === item.id && (
                                  <div
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    style={{ position: 'absolute', right: 0, top: 46, zIndex: 25, minWidth: 170, border: '1px solid #d8cdbc', borderRadius: 10, background: '#fffaf2', boxShadow: '0 10px 20px rgba(47,42,36,0.12)', padding: 6, display: 'grid', gap: 4 }}
                                  >
                                    <button onClick={() => { openTakeoffEdit(item.id); setOpenTakeoffMenuId(null); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Edit</button>
                                    <button onClick={() => duplicateTakeoffItem(item.id)} style={{ textAlign: 'left', border: 'none', background: 'transparent', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Duplicate</button>
                                    <button onClick={() => deleteTakeoffItem(item.id)} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#a1260d', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Delete</button>
                                  </div>
                                )}
                              </div>
                            </div>

                            {isExpanded && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #ece0d1', color: '#4b453d', fontSize: 13, display: 'grid', gap: 6 }}>
                                <div>Direct quantity: {item.quantity}</div>
                                <div>Dimensions: L {item.length} × W {item.width} × H {item.height}</div>
                                <div>Deduction: {item.deduction}</div>
                                {item.notes && <div><strong>Notes:</strong> {item.notes}</div>}
                                {linkedNames.length > 0 && (
                                  <div><strong>Linked assemblies:</strong> {linkedNames.join(', ')}</div>
                                )}
                                {item.sourceType !== 'manual' && item.sourceFile && (
                                  sourceFile ? (
                                    <button
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openTakeoffSourcePreview(item);
                                      }}
                                      style={{ justifySelf: 'start', minHeight: 36, border: '1px solid #d8cdbc', background: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                                    >
                                      Open source file
                                    </button>
                                  ) : (
                                    <div style={{ color: '#9a8f80' }}>Source file unavailable: {item.sourceFile}</div>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {activeStage === "assemblies" && (
        <AssembliesPanel
          assemblies={assembliesState}
          isLoading={isProjectDataLoading}
          saveStatus={saveStatus}
          onCreateAssembly={createAssembly}
          onImportAssembliesFromLibrary={importAssembliesFromLibrary}
          onDuplicateAssembly={duplicateAssembly}
          onDeleteAssembly={deleteAssembly}
          onAutosaveAssemblyEdit={autosaveAssemblyEdit}
        />
        )}

        {activeStage === "pricing" && (
        <section style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Project Pricing</h2>
              <div style={{ marginTop: 6, color: saveStatus === 'error' ? '#a1260d' : '#766b5d', fontSize: 12 }}>
                {isProjectDataLoading ? 'Loading pricing...' : saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Could not save' : 'Pricing updates autosave'}
              </div>
            </div>
            <button
              onClick={() => setPricingExpanded((current) => !current)}
              style={{ minHeight: 44, border: '1px solid #d8cdbc', background: '#fff', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}
            >
              {pricingExpanded ? 'Hide breakdown' : 'Show breakdown'}
            </button>
          </div>

          {pricingError && (
            <div style={{ marginTop: 10, border: '1px solid #e4b6ac', background: '#fff0ed', color: '#7d2613', borderRadius: 8, padding: '10px 12px' }}>
              {pricingError}
            </div>
          )}

          {pricingMessage && (
            <div style={{ marginTop: 10, border: '1px solid #c7dec8', background: '#eef9ef', color: '#2f6f42', borderRadius: 8, padding: '10px 12px' }}>
              {pricingMessage}
            </div>
          )}

          <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e6dac8', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>Labour</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.labourSubtotal)}</div></div>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>Materials</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.materialSubtotal)}</div></div>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>Equipment</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.equipmentSubtotal)}</div></div>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>Subcontract</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.subcontractSubtotal)}</div></div>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>Assembly markup</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.assemblyMarkup)}</div></div>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>Adjustments</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.projectAdjustmentsTotal)}</div></div>
              <div><div style={{ color: '#766b5d', fontSize: 12 }}>PST + GST</div><div style={{ fontWeight: 700 }}>{formatCurrency(computedPricingSummary.pst + computedPricingSummary.gst)}</div></div>
              <div style={{ border: '1px solid #d8cdbc', borderRadius: 8, background: '#fbf4e9', padding: 8 }}>
                <div style={{ color: '#594f43', fontSize: 12, fontWeight: 700 }}>Final project total</div>
                <div style={{ fontWeight: 800, fontSize: 20, color: '#2f2a24' }}>{formatCurrency(computedPricingSummary.finalProjectTotal)}</div>
              </div>
            </div>
            <div style={{ marginTop: 8, color: '#8b7f70', fontSize: 12 }}>
              Last saved total: {formatCurrency(persistedPricingSummary.finalProjectTotal)}
            </div>
          </div>

          {computedPricingSummary.hasIncompletePricing && (
            <div style={{ marginTop: 10, border: '1px solid #e5c98f', background: '#fff6e5', color: '#6f5324', borderRadius: 8, padding: '10px 12px' }}>
              Pricing is incomplete for {computedPricingSummary.incompleteAssemblies.length} assembl{computedPricingSummary.incompleteAssemblies.length === 1 ? 'y' : 'ies'}.
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {computedPricingSummary.incompleteAssemblies.map((item) => (
                  <div key={item.assemblyId}>• {item.assemblyName}: {item.reasons.join(' ')}</div>
                ))}
              </div>
            </div>
          )}

          {assembliesState.length === 0 && (
            <div style={{ marginTop: 10, border: '1px dashed #d8cdbc', borderRadius: 8, padding: 12, color: '#766b5d' }}>
              No assemblies yet. Add project assemblies to build pricing totals.
            </div>
          )}

          {pricingExpanded && (
            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              <div style={{ border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', padding: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Tax settings</div>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                    <input
                      type="checkbox"
                      checked={pricingSettings.pstEnabled}
                      onChange={(event) => updatePricingSettings({ pstEnabled: event.target.checked }, true)}
                      style={{ width: 18, height: 18 }}
                    />
                    <span>Enable PST</span>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>PST rate %</span>
                    <input
                      value={pricingSettings.pstRate}
                      onFocus={() => {
                        pricingRateFocusRef.current = {
                          pstRate: pricingSettings.pstRate,
                          gstRate: pricingSettings.gstRate,
                        };
                      }}
                      onChange={(event) => updatePricingSettings({ pstRate: Math.max(0, Number(event.target.value) || 0) })}
                      onBlur={() => {
                        const original = pricingRateFocusRef.current?.pstRate;
                        if (typeof original === 'number' && Math.abs(original - pricingSettings.pstRate) > 0.0001) {
                          logPricingSettingsActivity('PST rate was updated.', {
                            field: 'pstRate',
                            from: original,
                            to: pricingSettings.pstRate,
                          });
                        }
                      }}
                      inputMode="decimal"
                      style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>PST applies to</span>
                    <select
                      value={pricingSettings.pstAppliesTo}
                      onChange={(event) => updatePricingSettings({ pstAppliesTo: event.target.value as PricingTaxBase }, true)}
                      style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}
                    >
                      {PRICING_TAX_BASES.map((base) => <option key={`pst-${base}`} value={base}>{base}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                    <input
                      type="checkbox"
                      checked={pricingSettings.gstEnabled}
                      onChange={(event) => updatePricingSettings({ gstEnabled: event.target.checked }, true)}
                      style={{ width: 18, height: 18 }}
                    />
                    <span>Enable GST</span>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>GST rate %</span>
                    <input
                      value={pricingSettings.gstRate}
                      onFocus={() => {
                        pricingRateFocusRef.current = {
                          pstRate: pricingSettings.pstRate,
                          gstRate: pricingSettings.gstRate,
                        };
                      }}
                      onChange={(event) => updatePricingSettings({ gstRate: Math.max(0, Number(event.target.value) || 0) })}
                      onBlur={() => {
                        const original = pricingRateFocusRef.current?.gstRate;
                        if (typeof original === 'number' && Math.abs(original - pricingSettings.gstRate) > 0.0001) {
                          logPricingSettingsActivity('GST rate was updated.', {
                            field: 'gstRate',
                            from: original,
                            to: pricingSettings.gstRate,
                          });
                        }
                      }}
                      inputMode="decimal"
                      style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>GST applies to</span>
                    <select
                      value={pricingSettings.gstAppliesTo}
                      onChange={(event) => updatePricingSettings({ gstAppliesTo: event.target.value as PricingTaxBase }, true)}
                      style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}
                    >
                      {PRICING_TAX_BASES.map((base) => <option key={`gst-${base}`} value={base}>{base}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>Percent adjustment base</span>
                    <select
                      value={pricingSettings.adjustmentPercentBase}
                      onChange={(event) => updatePricingSettings({ adjustmentPercentBase: event.target.value === 'costSubtotal' ? 'costSubtotal' : 'sellingSubtotal' }, true)}
                      style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}
                    >
                      <option value="sellingSubtotal">sellingSubtotal</option>
                      <option value="costSubtotal">costSubtotal</option>
                    </select>
                  </label>
                </div>
                <div style={{ marginTop: 8, color: '#766b5d', fontSize: 12 }}>
                  {computedPricingSummary.taxExplanations.pst}
                </div>
                <div style={{ marginTop: 2, color: '#766b5d', fontSize: 12 }}>
                  {computedPricingSummary.taxExplanations.gst}
                </div>
              </div>

              <div style={{ border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700 }}>Project adjustments</div>
                  <button
                    onClick={openCreatePricingAdjustment}
                    style={{ minHeight: 44, border: 'none', background: '#594f43', color: '#fff', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}
                  >
                    Add adjustment
                  </button>
                </div>

                {isPricingAdjustmentEditorOpen ? (
                  <div style={{ marginTop: 10, border: '1px solid #e6dac8', borderRadius: 8, background: '#fffaf2', padding: 10, display: 'grid', gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>{editingAdjustmentId ? 'Edit adjustment' : 'New adjustment'}</div>
                    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                      <label style={{ display: 'grid', gap: 6 }}><span>Name</span><input value={pricingAdjustmentDraft.name} onChange={(event) => setPricingAdjustmentDraft((current) => ({ ...current, name: event.target.value }))} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} /></label>
                      <label style={{ display: 'grid', gap: 6 }}><span>Type</span><select value={pricingAdjustmentDraft.type} onChange={(event) => setPricingAdjustmentDraft((current) => ({ ...current, type: event.target.value as PricingAdjustmentType }))} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}>{PRICING_ADJUSTMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                      <label style={{ display: 'grid', gap: 6 }}><span>Amount type</span><select value={pricingAdjustmentDraft.amountType} onChange={(event) => setPricingAdjustmentDraft((current) => ({ ...current, amountType: event.target.value as PricingAdjustmentAmountType }))} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}><option value="fixed">fixed</option><option value="percent">percent</option></select></label>
                      <label style={{ display: 'grid', gap: 6 }}><span>Value</span><input value={pricingAdjustmentDraft.value} onChange={(event) => setPricingAdjustmentDraft((current) => ({ ...current, value: Math.max(0, Number(event.target.value) || 0) }))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} /></label>
                    </div>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>Notes</span>
                      <textarea value={pricingAdjustmentDraft.notes} onChange={(event) => setPricingAdjustmentDraft((current) => ({ ...current, notes: event.target.value }))} style={{ minHeight: 70, borderRadius: 8, border: '1px solid #d8cdbc', padding: 10 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                      <input type="checkbox" checked={pricingAdjustmentDraft.enabled} onChange={(event) => setPricingAdjustmentDraft((current) => ({ ...current, enabled: event.target.checked }))} style={{ width: 18, height: 18 }} />
                      <span>Enabled</span>
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={closePricingAdjustmentEditor} style={{ minHeight: 44, border: '1px solid #d8cdbc', background: '#fff', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => { void savePricingAdjustmentDraft(); }} style={{ minHeight: 44, border: 'none', background: '#594f43', color: '#fff', borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}>{editingAdjustmentId ? 'Save adjustment' : 'Add adjustment'}</button>
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {pricingAdjustments.length === 0 ? (
                    <div style={{ border: '1px dashed #d8cdbc', borderRadius: 8, padding: 10, color: '#766b5d' }}>No adjustments added yet.</div>
                  ) : (
                    pricingAdjustments.map((adjustment) => {
                      const applied = computedPricingSummary.projectAdjustments.find((entry) => entry.id === adjustment.id);
                      return (
                        <div
                          key={adjustment.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openEditPricingAdjustment(adjustment.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openEditPricingAdjustment(adjustment.id);
                            }
                          }}
                          style={{ border: '1px solid #e6dac8', borderRadius: 10, background: adjustment.enabled ? '#fff' : '#faf6ef', padding: 10, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', cursor: 'pointer' }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700 }}>{adjustment.name}</div>
                            <div style={{ marginTop: 4, color: '#766b5d', fontSize: 12 }}>
                              {adjustment.type} • {adjustment.amountType} {adjustment.value}{adjustment.amountType === 'percent' ? '%' : ''} • {adjustment.enabled ? 'enabled' : 'disabled'}
                            </div>
                            {adjustment.notes && <div style={{ marginTop: 4, color: '#8b7f70', fontSize: 12 }}>{adjustment.notes}</div>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontWeight: 700 }}>{formatCurrency(applied?.amount ?? 0)}</div>
                            <div style={{ position: 'relative' }}>
                              <button
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setOpenPricingAdjustmentMenuId((current) => current === adjustment.id ? null : adjustment.id);
                                }}
                                style={{ width: 44, height: 44, border: '1px solid #d8cdbc', background: '#fffaf2', borderRadius: 8, cursor: 'pointer' }}
                                aria-label={`Adjustment options for ${adjustment.name}`}
                              >
                                ⋯
                              </button>
                              {openPricingAdjustmentMenuId === adjustment.id && (
                                <div style={{ position: 'absolute', right: 0, top: 46, zIndex: 20, minWidth: 180, border: '1px solid #d8cdbc', borderRadius: 10, background: '#fffaf2', boxShadow: '0 10px 20px rgba(47,42,36,0.12)', padding: 6, display: 'grid', gap: 4 }}>
                                  <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); openEditPricingAdjustment(adjustment.id); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Edit</button>
                                  <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); void togglePricingAdjustmentEnabled(adjustment.id); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>{adjustment.enabled ? 'Disable' : 'Enable'}</button>
                                  <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); void duplicatePricingAdjustmentById(adjustment.id); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Duplicate</button>
                                  <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); void deletePricingAdjustmentById(adjustment.id); }} style={{ textAlign: 'left', border: 'none', background: 'transparent', color: '#a1260d', minHeight: 44, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }}>Delete</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', padding: 10, display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 700 }}>Pricing breakdown</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Cost subtotal</span><strong>{formatCurrency(computedPricingSummary.costSubtotal)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Assembly markup</span><strong>{formatCurrency(computedPricingSummary.assemblyMarkup)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Selling subtotal</span><strong>{formatCurrency(computedPricingSummary.sellingSubtotal)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Project adjustments</span><strong>{formatCurrency(computedPricingSummary.projectAdjustmentsTotal)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Pre-tax subtotal</span><strong>{formatCurrency(computedPricingSummary.preTaxSubtotal)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>PST</span><strong>{formatCurrency(computedPricingSummary.pst)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>GST</span><strong>{formatCurrency(computedPricingSummary.gst)}</strong></div>
                <div style={{ marginTop: 4, borderTop: '1px solid #ece0d1', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ fontWeight: 700 }}>Final project total</span><strong style={{ fontSize: 18 }}>{formatCurrency(computedPricingSummary.finalProjectTotal)}</strong></div>
              </div>
            </div>
          )}
        </section>
        )}

        {activeStage === "overview" && (
        <details className="project-understanding-details">
          <summary>Edit project understanding</summary>
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
        </details>
        )}

        {activeStage === "activity" && (
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
            <input
              type="search"
              value={activitySearch}
              onChange={(event) => { setActivitySearch(event.target.value); setActivityVisibleCount(20); }}
              placeholder="Search project history"
              aria-label="Search project history"
              style={{ minHeight: 44, minWidth: 220, flex: '1 1 260px', border: '1px solid #d8cdbc', borderRadius: 999, padding: '8px 14px', background: '#fff' }}
            />
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
            {groupedVisibleActivity.length === 0 ? (
              <div style={{ border: '1px dashed #d8cdbc', borderRadius: 8, padding: 12, color: '#766b5d' }}>
                {activityFilter === 'All' ? 'No project activity yet.' : `No activity in ${activityFilter}.`}
              </div>
            ) : (
              groupedVisibleActivity.map(([groupLabel, entries]) => (
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
          {visibleActivity.length < searchedActivity.length && (
            <button className="project-activity-load-more" onClick={() => setActivityVisibleCount((count) => count + 20)}>
              Load more activity
            </button>
          )}
        </section>
        )}

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

      {takeoffDraft && (
        <div onClick={closeTakeoffEditor} style={{ position: 'fixed', inset: 0, background: 'rgba(32, 25, 19, 0.35)', display: 'grid', placeItems: 'center', zIndex: 70, padding: 14 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(920px, 100%)', maxHeight: '90vh', overflow: 'auto', background: '#fffaf2', border: '1px solid #d8cdbc', borderRadius: 14, padding: 16, boxShadow: '0 18px 34px rgba(47,42,36,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{takeoffEditorItemId ? 'Edit takeoff item' : 'Create takeoff item'}</h3>
              <button onClick={closeTakeoffEditor} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', background: '#fff', padding: '10px 12px', cursor: 'pointer' }}>Cancel</button>
            </div>

            {takeoffValidationError && (
              <div style={{ marginTop: 10, border: '1px solid #e4b6ac', background: '#fff0ed', color: '#7d2613', borderRadius: 8, padding: '10px 12px' }}>
                {takeoffValidationError}
              </div>
            )}

            <div style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Name</span>
                <input value={takeoffDraft.name} onChange={(event) => updateTakeoffDraftField('name', event.target.value)} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Category</span>
                <select value={takeoffDraft.category} onChange={(event) => updateTakeoffDraftField('category', event.target.value as TakeoffCategory)} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}>
                  {TAKEOFF_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Location (room/area)</span>
                <input value={takeoffDraft.location} onChange={(event) => updateTakeoffDraftField('location', event.target.value)} placeholder="Example: Main Bathroom" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Unit</span>
                <select value={takeoffDraft.unit} onChange={(event) => updateTakeoffDraftField('unit', event.target.value as TakeoffItem['unit'])} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}>
                  {TAKEOFF_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
            </div>

            <div style={{ marginTop: 12, border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', padding: 10, display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Quantity input</div>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Direct quantity</span>
                  <input value={takeoffDraft.quantity} onChange={(event) => updateTakeoffDraftField('quantity', parseTakeoffNumber(event.target.value, 0))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Length</span>
                  <input value={takeoffDraft.length} onChange={(event) => updateTakeoffDraftField('length', parseTakeoffNumber(event.target.value, 0))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Width</span>
                  <input value={takeoffDraft.width} onChange={(event) => updateTakeoffDraftField('width', parseTakeoffNumber(event.target.value, 0))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Height</span>
                  <input value={takeoffDraft.height} onChange={(event) => updateTakeoffDraftField('height', parseTakeoffNumber(event.target.value, 0))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
                </label>
              </div>

              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Deduction</span>
                  <input value={takeoffDraft.deduction} onChange={(event) => updateTakeoffDraftField('deduction', parseTakeoffNumber(event.target.value, 0))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Waste %</span>
                  <input value={takeoffDraft.wastePercent} onChange={(event) => updateTakeoffDraftField('wastePercent', parseTakeoffNumber(event.target.value, 0))} inputMode="decimal" style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px' }} />
                </label>
              </div>

              <div style={{ color: '#594f43', fontSize: 13 }}>
                Net: {calculateTakeoffQuantities(takeoffDraft).netQuantity} {takeoffDraft.unit} • Final with waste: {takeoffDraft.calculatedQuantity} {takeoffDraft.unit}
              </div>
            </div>

            {takeoffSettings.showAdvancedFields && (
              <div style={{ marginTop: 12, border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', padding: 10, display: 'grid', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Advanced details</div>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Source type</span>
                  <select value={takeoffDraft.sourceType} onChange={(event) => updateTakeoffDraftField('sourceType', event.target.value as TakeoffSourceType)} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}>
                    {TAKEOFF_SOURCE_TYPES.map((sourceType) => <option key={sourceType} value={sourceType}>{sourceType}</option>)}
                  </select>
                </label>

                {takeoffDraft.sourceType === 'manual' ? (
                  <div style={{ color: '#766b5d', fontSize: 13 }}>Manual takeoff marked as manual input.</div>
                ) : (
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>Source file (optional)</span>
                    <select
                      value={takeoffDraft.sourceFile}
                      onChange={(event) => updateTakeoffDraftField('sourceFile', event.target.value)}
                      style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', padding: '10px 12px', background: '#fff' }}
                    >
                      <option value="">No source selected</option>
                      {projectFiles
                        .filter((file) => file.folder === sourceTypeFolderMap[takeoffDraft.sourceType])
                        .map((file) => (
                          <option key={`${file.folder}:${file.filename}`} value={file.filename}>{file.filename}</option>
                        ))}
                    </select>
                  </label>
                )}

                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Notes</span>
                  <textarea value={takeoffDraft.notes} onChange={(event) => updateTakeoffDraftField('notes', event.target.value)} style={{ minHeight: 76, borderRadius: 8, border: '1px solid #d8cdbc', padding: 10 }} />
                </label>
              </div>
            )}

            <div style={{ marginTop: 12, border: '1px solid #e6dac8', borderRadius: 10, background: '#fff', padding: 10, display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Link assemblies</div>
              {assembliesState.length === 0 ? (
                <div style={{ color: '#766b5d', fontSize: 13 }}>No project assemblies available to link yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {assembliesState.map((assembly) => {
                    const checked = takeoffDraft.linkedAssemblyIds.includes(assembly.id);
                    return (
                      <label key={assembly.id} style={{ border: '1px solid #ece0d1', borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 10, alignItems: 'flex-start', background: checked ? '#f4ecdf' : '#fff' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const isChecked = event.target.checked;
                            const linked = isChecked
                              ? Array.from(new Set([...takeoffDraft.linkedAssemblyIds, assembly.id]))
                              : takeoffDraft.linkedAssemblyIds.filter((id) => id !== assembly.id);
                            updateTakeoffDraftField('linkedAssemblyIds', linked);
                          }}
                          style={{ width: 18, height: 18, marginTop: 2 }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700 }}>{assembly.name}</div>
                          <div style={{ marginTop: 2, color: '#766b5d', fontSize: 12 }}>
                            Current quantity: {assembly.quantity} {assembly.unit}
                            {assembly.takeoffControl?.takeoffItemId
                              ? ` • Controlled by ${assembly.takeoffControl.takeoffItemName}`
                              : ''}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={closeTakeoffEditor} style={{ minHeight: 44, borderRadius: 8, border: '1px solid #d8cdbc', background: '#fff', padding: '10px 12px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveTakeoffDraft} style={{ minHeight: 44, borderRadius: 8, border: 'none', background: '#594f43', color: '#fff', padding: '10px 14px', cursor: 'pointer' }}>
                {takeoffEditorItemId ? 'Save item' : 'Create item'}
              </button>
            </div>
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
