import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAssemblies } from "../../../../lib/assembly-estimating";
import {
  buildProjectPricingSummary,
  createDefaultPricingSettings,
  normalizePricingAdjustments,
  normalizePricingSettings,
  normalizePricingSummary,
  type PricingAdjustment,
  type PricingSettings,
  type PricingSummary,
} from "../../../../lib/project-pricing";
import {
  defaultTakeoffSettings,
  normalizeTakeoffGroups,
  normalizeTakeoffItems,
  normalizeTakeoffSettings,
  syncTakeoffGroupsWithItems,
  type TakeoffGroup,
  type TakeoffItem,
  type TakeoffSettings,
} from "../../../../lib/takeoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_PATH = String.raw`K:\RenovationPlatform\Dimcan Workspace`;
const PROJECTS_ROOT = path.join(WORKSPACE_PATH, "Projects");
const PROJECT_SCHEMA_VERSION = 2;

const NOTE_CATEGORIES = ["General", "Client", "Site", "Scope", "Pricing", "Decision"] as const;
const ACTIVITY_TYPES = [
  "file-uploaded",
  "file-deleted",
  "file-renamed",
  "file-moved",
  "project-title-updated",
  "project-notes-updated",
  "project-understanding-updated",
  "assembly-added",
  "assembly-edited",
  "assembly-removed",
  "takeoff-created",
  "takeoff-edited",
  "takeoff-duplicated",
  "takeoff-deleted",
  "takeoff-linked",
  "takeoff-unlinked",
  "pricing-settings-updated",
  "pricing-adjustment-updated",
  "project-archived",
  "project-restored",
  "update",
  "decision",
  "client-request",
  "site-condition",
  "project",
] as const;
const ACTIVITY_SOURCES = ["system", "user", "ai"] as const;

type NoteCategory = (typeof NOTE_CATEGORIES)[number];
type ActivityType = (typeof ACTIVITY_TYPES)[number];
type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

type ProjectNote = {
  id: string;
  text: string;
  category: NoteCategory;
  createdAt: string;
  updatedAt: string;
};

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

type ProjectData = {
  schemaVersion: number;
  displayTitle: string;
  notes: ProjectNote[];
  activity: ActivityEntry[];
  assemblies: unknown[];
  takeoffItems: TakeoffItem[];
  takeoffGroups: TakeoffGroup[];
  takeoffSettings: TakeoffSettings;
  pricingSettings: PricingSettings;
  pricingAdjustments: PricingAdjustment[];
  pricingSummary: PricingSummary;
  understandingOverrides: Record<string, unknown>;
  attributionData: Record<string, "AI" | "User">;
  updatedAt: string;
};

type ProjectPatch = Partial<{
  displayTitle: string;
  notes: ProjectNote[];
  activity: ActivityEntry[];
  assemblies: unknown[];
  takeoffItems: TakeoffItem[];
  takeoffGroups: TakeoffGroup[];
  takeoffSettings: TakeoffSettings;
  pricingSettings: PricingSettings;
  pricingAdjustments: PricingAdjustment[];
  pricingSummary: PricingSummary;
  understandingOverrides: Record<string, unknown>;
  attributionData: Record<string, "AI" | "User">;
}>;

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    { status },
  );
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
}

function sanitizeText(value: unknown, maxLength = 1000) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, maxLength);
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return new Date().toISOString();
  }
  return new Date(time).toISOString();
}

function normalizeNoteCategory(value: unknown): NoteCategory {
  return NOTE_CATEGORIES.includes(value as NoteCategory) ? (value as NoteCategory) : "General";
}

function normalizeActivityType(value: unknown): ActivityType {
  return ACTIVITY_TYPES.includes(value as ActivityType) ? (value as ActivityType) : "project";
}

function normalizeActivitySource(value: unknown): ActivitySource {
  return ACTIVITY_SOURCES.includes(value as ActivitySource) ? (value as ActivitySource) : "system";
}

function normalizeNote(raw: unknown): ProjectNote | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const text = sanitizeText(source.text, 5000);
  if (!text) {
    return null;
  }

  return {
    id: sanitizeText(source.id, 120) || randomUUID(),
    text,
    category: normalizeNoteCategory(source.category),
    createdAt: safeTimestamp(source.createdAt),
    updatedAt: safeTimestamp(source.updatedAt),
  };
}

function normalizeActivityEntry(raw: unknown): ActivityEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const title = sanitizeText(source.title, 200);
  if (!title) {
    return null;
  }

  const metadata =
    source.metadata && typeof source.metadata === "object"
      ? (source.metadata as Record<string, unknown>)
      : {};

  return {
    id: sanitizeText(source.id, 120) || randomUUID(),
    type: normalizeActivityType(source.type),
    title,
    description: sanitizeText(source.description, 5000),
    timestamp: safeTimestamp(source.timestamp),
    source: normalizeActivitySource(source.source),
    relatedFile: sanitizeText(source.relatedFile, 260) || null,
    relatedFolder: sanitizeText(source.relatedFolder, 120) || null,
    metadata,
  };
}

function dedupeActivity(entries: ActivityEntry[]) {
  const seen = new Set<string>();
  const deduped: ActivityEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.id}|${entry.type}|${entry.title}|${entry.timestamp}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  deduped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return deduped;
}

function validateProjectName(projectNameRaw: string) {
  const projectName = sanitizePathSegment(projectNameRaw);
  if (!projectName || projectName === "." || projectName === "..") {
    throw new Error("Invalid project name.");
  }
  return projectName;
}

function ensureWithin(parentPath: string, childPath: string) {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function getProjectNameFromRequest(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const match = pathname.match(/\/api\/projects\/([^/]+)\/?$/);
  const segment = match?.[1] ?? "";
  return validateProjectName(decodeURIComponent(segment));
}

function getProjectPath(projectName: string) {
  const projectPath = path.join(PROJECTS_ROOT, projectName);
  if (!ensureWithin(PROJECTS_ROOT, projectPath)) {
    throw new Error("Invalid project path.");
  }
  return projectPath;
}

function getProjectFilePath(projectPath: string) {
  const filePath = path.join(projectPath, "project.json");
  if (!ensureWithin(projectPath, filePath)) {
    throw new Error("Invalid project file path.");
  }
  return filePath;
}

function createDefaultProjectData(projectName: string): ProjectData {
  const takeoffSettings = defaultTakeoffSettings();
  const takeoffItems = normalizeTakeoffItems([], takeoffSettings);
  const takeoffGroups = syncTakeoffGroupsWithItems(takeoffItems, []);
  const pricingSettings = createDefaultPricingSettings();
  const pricingAdjustments = normalizePricingAdjustments([]);
  const pricingSummary = buildProjectPricingSummary({
    assemblies: [],
    takeoffItems,
    pricingSettings,
    pricingAdjustments,
  });

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    displayTitle: projectName,
    notes: [],
    activity: [],
    assemblies: [],
    takeoffItems,
    takeoffGroups,
    takeoffSettings,
    pricingSettings,
    pricingAdjustments,
    pricingSummary,
    understandingOverrides: {},
    attributionData: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProjectData(raw: unknown, projectName: string): ProjectData {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const takeoffSettings = normalizeTakeoffSettings(source.takeoffSettings);
  const takeoffItems = normalizeTakeoffItems(source.takeoffItems, takeoffSettings);
  const takeoffGroups = syncTakeoffGroupsWithItems(
    takeoffItems,
    normalizeTakeoffGroups(source.takeoffGroups),
  );
  const pricingSettings = normalizePricingSettings(source.pricingSettings);
  const pricingAdjustments = normalizePricingAdjustments(source.pricingAdjustments);
  const normalizedAssemblies = Array.isArray(source.assemblies) ? source.assemblies : [];
  const normalizedAssemblyRecords = normalizeAssemblies(normalizedAssemblies);
  const pricingSummary = source.pricingSummary
    ? normalizePricingSummary(source.pricingSummary)
    : buildProjectPricingSummary({
        assemblies: normalizedAssemblyRecords,
        takeoffItems,
        pricingSettings,
        pricingAdjustments,
      });

  const migratedNotes = (() => {
    if (Array.isArray(source.notes)) {
      return source.notes.map(normalizeNote).filter((note): note is ProjectNote => Boolean(note));
    }

    if (typeof source.notes === "string" && source.notes.trim()) {
      const now = new Date().toISOString();
      return [
        {
          id: randomUUID(),
          text: sanitizeText(source.notes, 5000),
          category: "General" as const,
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    return [];
  })();

  const migratedActivity = (() => {
    if (Array.isArray(source.activity) && source.activity.every((item) => typeof item === "string")) {
      return (source.activity as string[])
        .map((entry): ActivityEntry | null => {
          const text = sanitizeText(entry, 5000);
          if (!text) {
            return null;
          }
          return {
            id: randomUUID(),
            type: "project" as const,
            title: "Legacy activity",
            description: text,
            timestamp: safeTimestamp(source.updatedAt),
            source: "system" as const,
            relatedFile: null,
            relatedFolder: null,
            metadata: { migratedFrom: "string[]" },
          };
        })
        .filter((item): item is ActivityEntry => item !== null);
    }

    if (Array.isArray(source.activity)) {
      return source.activity
        .map(normalizeActivityEntry)
        .filter((entry): entry is ActivityEntry => Boolean(entry));
    }

    return [];
  })();

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    displayTitle:
      typeof source.displayTitle === "string" && source.displayTitle.trim()
        ? source.displayTitle
        : projectName,
    notes: migratedNotes,
    activity: dedupeActivity(migratedActivity),
    assemblies: normalizedAssemblies,
    takeoffItems,
    takeoffGroups,
    takeoffSettings,
    pricingSettings,
    pricingAdjustments,
    pricingSummary,
    understandingOverrides:
      source.understandingOverrides && typeof source.understandingOverrides === "object"
        ? (source.understandingOverrides as Record<string, unknown>)
        : {},
    attributionData:
      source.attributionData && typeof source.attributionData === "object"
        ? Object.fromEntries(
            Object.entries(source.attributionData as Record<string, unknown>).filter(
              ([, value]) => value === "AI" || value === "User",
            ),
          ) as Record<string, "AI" | "User">
        : {},
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt
        ? source.updatedAt
        : new Date().toISOString(),
  };
}

function isProjectDataEffectivelyEmpty(project: ProjectData, projectName: string) {
  const title = project.displayTitle.trim();
  return (
    (title === "" || title === projectName) &&
    project.notes.length === 0 &&
    project.activity.length === 0 &&
    project.assemblies.length === 0 &&
    project.takeoffItems.length === 0 &&
    project.pricingAdjustments.length === 0 &&
    Object.keys(project.understandingOverrides).length === 0 &&
    Object.keys(project.attributionData).length === 0
  );
}

async function writeProjectDataAtomic(projectFilePath: string, data: ProjectData) {
  const tempPath = `${projectFilePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const serialized = JSON.stringify(data, null, 2);

  await fs.writeFile(tempPath, serialized, "utf8");
  await fs.rename(tempPath, projectFilePath);
}

async function ensureAndReadProjectData(projectName: string) {
  const projectPath = getProjectPath(projectName);
  await fs.mkdir(projectPath, { recursive: true });

  const projectFilePath = getProjectFilePath(projectPath);

  try {
    const text = await fs.readFile(projectFilePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    const normalized = normalizeProjectData(parsed, projectName);
    return { projectPath, projectFilePath, data: normalized };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const initial = createDefaultProjectData(projectName);
    await writeProjectDataAtomic(projectFilePath, initial);
    return { projectPath, projectFilePath, data: initial };
  }
}

function mergePatch(current: ProjectData, patch: ProjectPatch, projectName: string): ProjectData {
  const next: ProjectData = {
    ...current,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };

  if (typeof patch.displayTitle === "string") {
    const title = patch.displayTitle.trim();
    next.displayTitle = title || projectName;
  }

  if (Array.isArray(patch.notes)) {
    next.notes = patch.notes
      .map(normalizeNote)
      .filter((note): note is ProjectNote => Boolean(note));
  }

  if (Array.isArray(patch.activity)) {
    next.activity = dedupeActivity(
      patch.activity
        .map(normalizeActivityEntry)
        .filter((entry): entry is ActivityEntry => Boolean(entry)),
    );
  }

  if (Array.isArray(patch.assemblies)) {
    next.assemblies = patch.assemblies;
  }

  if (patch.takeoffSettings && typeof patch.takeoffSettings === "object") {
    next.takeoffSettings = normalizeTakeoffSettings(patch.takeoffSettings);
  }

  if (patch.pricingSettings && typeof patch.pricingSettings === "object") {
    next.pricingSettings = normalizePricingSettings(patch.pricingSettings);
  }

  if (Array.isArray(patch.pricingAdjustments)) {
    next.pricingAdjustments = normalizePricingAdjustments(patch.pricingAdjustments);
  }

  if (patch.pricingSummary && typeof patch.pricingSummary === "object") {
    next.pricingSummary = normalizePricingSummary(patch.pricingSummary);
  }

  if (Array.isArray(patch.takeoffItems)) {
    next.takeoffItems = normalizeTakeoffItems(patch.takeoffItems, next.takeoffSettings);
  }

  if (Array.isArray(patch.takeoffGroups)) {
    next.takeoffGroups = normalizeTakeoffGroups(patch.takeoffGroups);
  }

  next.takeoffGroups = syncTakeoffGroupsWithItems(next.takeoffItems, next.takeoffGroups);
  const normalizedAssemblyRecords = normalizeAssemblies(next.assemblies);
  next.pricingSummary = buildProjectPricingSummary({
    assemblies: normalizedAssemblyRecords,
    takeoffItems: next.takeoffItems,
    pricingSettings: next.pricingSettings,
    pricingAdjustments: next.pricingAdjustments,
  });

  if (patch.understandingOverrides && typeof patch.understandingOverrides === "object") {
    next.understandingOverrides = patch.understandingOverrides;
  }

  if (patch.attributionData && typeof patch.attributionData === "object") {
    next.attributionData = Object.fromEntries(
      Object.entries(patch.attributionData).filter(([, value]) => value === "AI" || value === "User"),
    ) as Record<string, "AI" | "User">;
  }

  return next;
}

export async function GET(request: NextRequest) {
  try {
    const projectName = getProjectNameFromRequest(request);
    const { data } = await ensureAndReadProjectData(projectName);

    return NextResponse.json({
      success: true,
      project: data,
      isEmpty: isProjectDataEffectivelyEmpty(data, projectName),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read project data.";
    const status =
      message === "Invalid project name." ||
      message === "Invalid project path." ||
      message === "Invalid project file path."
        ? 400
        : 500;

    return errorResponse(status, message.includes("JSON") ? "Project data is corrupted." : message);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const projectName = getProjectNameFromRequest(request);
    const { projectFilePath, data: current } = await ensureAndReadProjectData(projectName);

    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return errorResponse(400, "Invalid request body.");
    }

    const patch = body as ProjectPatch;
    const next = mergePatch(current, patch, projectName);
    await writeProjectDataAtomic(projectFilePath, next);

    return NextResponse.json({
      success: true,
      project: next,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save project data.";
    const status =
      message === "Invalid project name." ||
      message === "Invalid project path." ||
      message === "Invalid project file path." ||
      message === "Invalid request body."
        ? 400
        : 500;

    return errorResponse(status, message);
  }
}
