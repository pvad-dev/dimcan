import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  ASSEMBLY_LIBRARY_SCHEMA_VERSION,
  applyAssemblyCalculations,
  cloneTemplate,
  createTemplateFromProjectAssembly,
  normalizeLibraryTemplate,
  normalizeLibraryTemplates,
  type AssemblyLibraryData,
  type AssemblyLibraryTemplate,
  type ProjectAssemblyRecord,
} from "../../../lib/assembly-estimating";
import { WORKSPACE_PATH } from "../../../lib/workspace-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIBRARY_FILE_PATH = path.join(WORKSPACE_PATH, "assembly-library.json");

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    { status },
  );
}

function createEmptyLibrary(): AssemblyLibraryData {
  return {
    schemaVersion: ASSEMBLY_LIBRARY_SCHEMA_VERSION,
    templates: [],
    archivedTemplates: [],
    updatedAt: new Date().toISOString(),
  };
}

async function writeLibraryAtomic(data: AssemblyLibraryData) {
  const tempPath = `${LIBRARY_FILE_PATH}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.mkdir(WORKSPACE_PATH, { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, LIBRARY_FILE_PATH);
}

function normalizeLibrary(raw: unknown): AssemblyLibraryData {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const templates = normalizeLibraryTemplates(source.templates);
  const archivedTemplates = normalizeLibraryTemplates(source.archivedTemplates);

  return {
    schemaVersion: ASSEMBLY_LIBRARY_SCHEMA_VERSION,
    templates,
    archivedTemplates,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureAndReadLibrary() {
  await fs.mkdir(WORKSPACE_PATH, { recursive: true });

  try {
    const raw = await fs.readFile(LIBRARY_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const data = normalizeLibrary(parsed);
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const empty = createEmptyLibrary();
    await writeLibraryAtomic(empty);
    return empty;
  }
}

function findTemplateById(data: AssemblyLibraryData, templateId: string) {
  const activeIndex = data.templates.findIndex((template) => template.id === templateId);
  if (activeIndex >= 0) {
    return {
      scope: "active" as const,
      index: activeIndex,
      template: data.templates[activeIndex],
    };
  }

  const archivedIndex = data.archivedTemplates.findIndex((template) => template.id === templateId);
  if (archivedIndex >= 0) {
    return {
      scope: "archived" as const,
      index: archivedIndex,
      template: data.archivedTemplates[archivedIndex],
    };
  }

  return null;
}

function safeTemplateFromBody(body: unknown) {
  const normalized = normalizeLibraryTemplate(body);
  if (!normalized) {
    throw new Error("Invalid template payload.");
  }
  return normalized;
}

function normalizeProjectAssemblyFromBody(body: unknown) {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!source) {
    throw new Error("Invalid project assembly payload.");
  }

  const templateCandidate = normalizeLibraryTemplate(source);
  if (!templateCandidate) {
    throw new Error("Invalid project assembly payload.");
  }

  const projectAssembly: ProjectAssemblyRecord = {
    ...templateCandidate,
    sourceTemplateId: typeof source.sourceTemplateId === "string" ? source.sourceTemplateId : undefined,
  };

  return applyAssemblyCalculations(projectAssembly);
}

function updatedLibrary(data: AssemblyLibraryData): AssemblyLibraryData {
  return {
    ...data,
    schemaVersion: ASSEMBLY_LIBRARY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const data = await ensureAndReadLibrary();
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") !== "false";

    return NextResponse.json({
      success: true,
      library: {
        schemaVersion: data.schemaVersion,
        updatedAt: data.updatedAt,
        templates: data.templates,
        archivedTemplates: includeArchived ? data.archivedTemplates : [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read assembly library.";
    return errorResponse(500, message.includes("JSON") ? "Assembly library is corrupted." : message);
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await ensureAndReadLibrary();
    const body = (await request.json()) as {
      action?: string;
      template?: unknown;
      templateId?: unknown;
      assembly?: unknown;
      mode?: unknown;
      targetTemplateId?: unknown;
    };

    const action = String(body.action ?? "");

    if (action === "create") {
      const template = safeTemplateFromBody(body.template);
      const nextTemplate: AssemblyLibraryTemplate = {
        ...template,
        id: template.id || randomUUID(),
        archivedAt: null,
        createdAt: template.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.templates.unshift(nextTemplate);
      const nextData = updatedLibrary(data);
      await writeLibraryAtomic(nextData);
      return NextResponse.json({ success: true, template: nextTemplate, library: nextData });
    }

    if (action === "duplicate") {
      const templateId = String(body.templateId ?? "").trim();
      if (!templateId) {
        return errorResponse(400, "Template ID is required.");
      }

      const found = findTemplateById(data, templateId);
      if (!found || found.scope !== "active") {
        return errorResponse(404, "Template not found.");
      }

      const duplicated = cloneTemplate(found.template);
      data.templates.unshift(duplicated);
      const nextData = updatedLibrary(data);
      await writeLibraryAtomic(nextData);
      return NextResponse.json({ success: true, template: duplicated, library: nextData });
    }

    if (action === "save-from-project") {
      const mode = String(body.mode ?? "copy").toLowerCase();
      const assembly = normalizeProjectAssemblyFromBody(body.assembly);

      if (mode === "replace") {
        const targetTemplateId = String(body.targetTemplateId ?? "").trim();
        if (!targetTemplateId) {
          return errorResponse(400, "Target template ID is required for replace mode.");
        }

        const found = findTemplateById(data, targetTemplateId);
        if (!found) {
          return errorResponse(404, "Template to replace could not be found.");
        }

        const replacement: AssemblyLibraryTemplate = {
          ...createTemplateFromProjectAssembly(assembly),
          id: found.template.id,
          archivedAt: found.scope === "archived" ? found.template.archivedAt : null,
          createdAt: found.template.createdAt,
          updatedAt: new Date().toISOString(),
        };

        if (found.scope === "active") {
          data.templates[found.index] = replacement;
        } else {
          data.archivedTemplates[found.index] = {
            ...replacement,
            archivedAt: found.template.archivedAt || new Date().toISOString(),
          };
        }

        const nextData = updatedLibrary(data);
        await writeLibraryAtomic(nextData);
        return NextResponse.json({ success: true, template: replacement, library: nextData });
      }

      const created = createTemplateFromProjectAssembly(assembly);
      data.templates.unshift(created);
      const nextData = updatedLibrary(data);
      await writeLibraryAtomic(nextData);
      return NextResponse.json({ success: true, template: created, library: nextData });
    }

    return errorResponse(400, "Unknown assembly library action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update assembly library.";
    const status = message.includes("payload") || message.includes("Unknown") ? 400 : 500;
    return errorResponse(status, message);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const data = await ensureAndReadLibrary();
    const body = (await request.json()) as {
      action?: string;
      templateId?: unknown;
      template?: unknown;
    };

    const action = String(body.action ?? "");
    const templateId = String(body.templateId ?? "").trim();

    if (!templateId) {
      return errorResponse(400, "Template ID is required.");
    }

    const found = findTemplateById(data, templateId);
    if (!found) {
      return errorResponse(404, "Template not found.");
    }

    if (action === "edit") {
      const incoming = safeTemplateFromBody(body.template);
      const updated: AssemblyLibraryTemplate = {
        ...incoming,
        id: found.template.id,
        createdAt: found.template.createdAt,
        updatedAt: new Date().toISOString(),
        archivedAt: found.scope === "archived" ? found.template.archivedAt || new Date().toISOString() : null,
      };

      if (found.scope === "active") {
        data.templates[found.index] = updated;
      } else {
        data.archivedTemplates[found.index] = updated;
      }

      const nextData = updatedLibrary(data);
      await writeLibraryAtomic(nextData);
      return NextResponse.json({ success: true, template: updated, library: nextData });
    }

    if (action === "archive") {
      if (found.scope !== "active") {
        return errorResponse(400, "Template is already archived.");
      }

      const archivedTemplate: AssemblyLibraryTemplate = {
        ...found.template,
        archivedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      data.templates.splice(found.index, 1);
      data.archivedTemplates.unshift(archivedTemplate);
      const nextData = updatedLibrary(data);
      await writeLibraryAtomic(nextData);
      return NextResponse.json({ success: true, template: archivedTemplate, library: nextData });
    }

    if (action === "restore") {
      if (found.scope !== "archived") {
        return errorResponse(400, "Template is already active.");
      }

      const restoredTemplate: AssemblyLibraryTemplate = {
        ...found.template,
        archivedAt: null,
        updatedAt: new Date().toISOString(),
      };

      data.archivedTemplates.splice(found.index, 1);
      data.templates.unshift(restoredTemplate);
      const nextData = updatedLibrary(data);
      await writeLibraryAtomic(nextData);
      return NextResponse.json({ success: true, template: restoredTemplate, library: nextData });
    }

    return errorResponse(400, "Unknown assembly library action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update assembly library.";
    const status = message.includes("Unknown") ? 400 : 500;
    return errorResponse(status, message);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const data = await ensureAndReadLibrary();
    const body = (await request.json()) as { templateId?: unknown };
    const templateId = String(body.templateId ?? "").trim();

    if (!templateId) {
      return errorResponse(400, "Template ID is required.");
    }

    const found = findTemplateById(data, templateId);
    if (!found) {
      return errorResponse(404, "Template not found.");
    }

    if (found.scope === "active") {
      data.templates.splice(found.index, 1);
    } else {
      data.archivedTemplates.splice(found.index, 1);
    }

    const nextData = updatedLibrary(data);
    await writeLibraryAtomic(nextData);

    return NextResponse.json({ success: true, templateId, library: nextData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete template.";
    return errorResponse(500, message);
  }
}
