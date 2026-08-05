import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT, STANDARD_FOLDERS, WORKSPACE_PATH } from "../../../lib/workspace-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_FOLDERS = [
  "Photos",
  "Videos",
  "Drawings",
  "Notes",
  "Documents",
];

type WorkspaceActivityEntry = {
  id: string;
  type: "project-title-updated" | "project-archived" | "project-restored" | "project";
  title: string;
  description: string;
  timestamp: string;
  source: "system" | "user" | "ai";
  relatedFile: string | null;
  relatedFolder: string | null;
  metadata: Record<string, unknown>;
};

async function initializeWorkspace() {
  await fs.mkdir(WORKSPACE_PATH, { recursive: true });

  await Promise.all(
    STANDARD_FOLDERS.map((folderName) =>
      fs.mkdir(path.join(WORKSPACE_PATH, folderName), {
        recursive: true,
      }),
    ),
  );

  const projectsPath = path.join(WORKSPACE_PATH, "Projects");

  const entries = await fs.readdir(projectsPath, {
    withFileTypes: true,
  });

  const projects = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    workspacePath: WORKSPACE_PATH,
    folders: STANDARD_FOLDERS,
    projects,
  };
}

function cleanProjectName(projectName: string) {
  return projectName.trim();
}

function isWindowsReservedName(projectName: string) {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(projectName);
}

function validateProjectName(projectNameRaw: string, options?: { fieldName?: string }) {
  const fieldName = options?.fieldName ?? "project name";
  const projectName = cleanProjectName(projectNameRaw);

  if (!projectName) {
    throw new Error(`Enter a ${fieldName}.`);
  }

  if (projectName === "." || projectName === "..") {
    throw new Error("Invalid project name.");
  }

  if (/[<>:"/\\|?*\x00-\x1f]/.test(projectName)) {
    throw new Error("Project name contains invalid characters.");
  }

  if (/[. ]$/.test(projectName)) {
    throw new Error("Project name cannot end with a space or period.");
  }

  if (isWindowsReservedName(projectName)) {
    throw new Error("Project name is reserved by Windows.");
  }

  return projectName;
}

function ensureWithin(parentPath: string, childPath: string) {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function projectPath(projectName: string) {
  const target = path.join(PROJECTS_ROOT, projectName);
  if (!ensureWithin(PROJECTS_ROOT, target)) {
    throw new Error("Invalid project path.");
  }
  return target;
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function appendProjectHistory(
  projectDir: string,
  entry: Omit<WorkspaceActivityEntry, "id" | "timestamp">,
) {
  const projectFilePath = path.join(projectDir, "project.json");
  const now = new Date().toISOString();

  const fallback = {
    schemaVersion: 2,
    displayTitle: path.basename(projectDir),
    notes: [],
    activity: [],
    assemblies: [],
    takeoffItems: [],
    takeoffGroups: [],
    takeoffSettings: {
      defaultWastePercent: 10,
      showAdvancedFields: false,
      groupBy: "location",
    },
    understandingOverrides: {},
    attributionData: {},
    updatedAt: now,
  } as Record<string, unknown>;

  let projectData = fallback;

  try {
    const raw = await fs.readFile(projectFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      projectData = { ...fallback, ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // Use fallback when file is missing or invalid.
  }

  const currentActivityRaw = Array.isArray(projectData.activity)
    ? projectData.activity
    : [];

  const currentActivity = currentActivityRaw.filter(
    (item): item is WorkspaceActivityEntry => Boolean(item && typeof item === "object"),
  );

  const nextEntry: WorkspaceActivityEntry = {
    id: randomUUID(),
    type: entry.type,
    title: entry.title,
    description: entry.description,
    timestamp: now,
    source: entry.source,
    relatedFile: entry.relatedFile,
    relatedFolder: entry.relatedFolder,
    metadata: entry.metadata,
  };

  const nextData = {
    ...projectData,
    schemaVersion: 2,
    activity: [nextEntry, ...currentActivity],
    updatedAt: now,
  };

  const tempFilePath = `${projectFilePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(tempFilePath, JSON.stringify(nextData, null, 2), "utf8");
  await fs.rename(tempFilePath, projectFilePath);
}

async function updateProjectDataForRename(projectDir: string, oldName: string, newName: string) {
  const projectFilePath = path.join(projectDir, "project.json");
  const now = new Date().toISOString();

  const fallback = {
    schemaVersion: 2,
    displayTitle: newName,
    notes: [],
    activity: [],
    assemblies: [],
    takeoffItems: [],
    takeoffGroups: [],
    takeoffSettings: {
      defaultWastePercent: 10,
      showAdvancedFields: false,
      groupBy: "location",
    },
    understandingOverrides: {},
    attributionData: {},
    updatedAt: now,
  } as Record<string, unknown>;

  let projectData = fallback;

  try {
    const raw = await fs.readFile(projectFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      projectData = { ...fallback, ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // Use fallback when file is missing or invalid.
  }

  const assemblies = Array.isArray(projectData.assemblies) ? projectData.assemblies : [];
  const nextAssemblies = assemblies.map((assembly) => {
    if (!assembly || typeof assembly !== "object") {
      return assembly;
    }
    const record = assembly as Record<string, unknown>;
    if (record.projectId === oldName) {
      return {
        ...record,
        projectId: newName,
      };
    }
    return record;
  });

  const nextData = {
    ...projectData,
    schemaVersion: 2,
    displayTitle: newName,
    assemblies: nextAssemblies,
    updatedAt: now,
  };

  const tempFilePath = `${projectFilePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(tempFilePath, JSON.stringify(nextData, null, 2), "utf8");
  await fs.rename(tempFilePath, projectFilePath);
}

function projectUpdateErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "The project could not be updated.";
  }

  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code === "EPERM" || nodeError.code === "EACCES") {
    return "The project folder could not be renamed because it is in use or permission was denied.";
  }

  if (nodeError.code === "ENOENT") {
    return "The project folder could not be found.";
  }

  return nodeError.message || "The project could not be updated.";
}

export async function GET(request: NextRequest) {
  try {
    const workspace = await initializeWorkspace();
    const view = request.nextUrl.searchParams.get("view");

    if (view === "archive") {
      const archiveProjectsPath = path.join(
        WORKSPACE_PATH,
        "Archive",
        "Projects",
      );

      await fs.mkdir(archiveProjectsPath, { recursive: true });

      const archivedEntries = await fs.readdir(archiveProjectsPath, {
        withFileTypes: true,
      });

      const archivedProjects = archivedEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

      return NextResponse.json({
        success: true,
        workspacePath: archiveProjectsPath,
        projects: archivedProjects,
      });
    }

    return NextResponse.json({
      success: true,
      ...workspace,
    });
  } catch (error) {
    console.error("Workspace error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "The workspace could not be opened.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeWorkspace();

    const body = await request.json();
    let projectName = "";

    try {
      projectName = validateProjectName(String(body.projectName ?? ""));
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Invalid project name.",
        },
        { status: 400 },
      );
    }

    const newProjectPath = projectPath(projectName);

    if (await pathExists(newProjectPath)) {
      return NextResponse.json(
        {
          success: false,
          message: "A project with that name already exists.",
        },
        { status: 409 },
      );
    }

    await fs.mkdir(newProjectPath, { recursive: true });

    await Promise.all(
      PROJECT_FOLDERS.map((folderName) =>
        fs.mkdir(path.join(newProjectPath, folderName), {
          recursive: true,
        }),
      ),
    );

    return NextResponse.json({
      success: true,
      projectName,
    });
  } catch (error) {
    console.error("Project creation error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "The project could not be created.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await initializeWorkspace();

    const body = await request.json();
    const action = String(body.action ?? "");
    let currentName = "";

    try {
      currentName = validateProjectName(String(body.projectName ?? ""));
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Invalid project name.",
        },
        { status: 400 },
      );
    }

    if (action === "restore") {
      const archiveProjectsPath = path.join(
        WORKSPACE_PATH,
        "Archive",
        "Projects",
      );
      const archivedPath = path.join(archiveProjectsPath, currentName);
      const restoredPath = projectPath(currentName);

      if (!(await pathExists(archivedPath))) {
        return NextResponse.json(
          {
            success: false,
            message: "The archived project folder could not be found.",
          },
          { status: 404 },
        );
      }

      if (await pathExists(restoredPath)) {
        return NextResponse.json(
          {
            success: false,
            message: "An active project with that name already exists.",
          },
          { status: 409 },
        );
      }

      await fs.rename(archivedPath, restoredPath);
      await appendProjectHistory(restoredPath, {
        type: "project-restored",
        title: "Project restored",
        description: `${currentName} restored from archive.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: {},
      });

      return NextResponse.json({
        success: true,
        projectName: currentName,
      });
    }

    const currentPath = projectPath(currentName);

    if (!(await pathExists(currentPath))) {
      return NextResponse.json(
        {
          success: false,
          message: "The project folder could not be found.",
        },
        { status: 404 },
      );
    }

    if (action === "rename") {
      let newName = "";

      try {
        newName = validateProjectName(String(body.newProjectName ?? ""), {
          fieldName: "new project name",
        });
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            message: error instanceof Error ? error.message : "Invalid project name.",
          },
          { status: 400 },
        );
      }

      if (newName === currentName) {
        return NextResponse.json({
          success: true,
          projectName: currentName,
        });
      }

      const renamedPath = projectPath(newName);
      const isCaseOnlyRename =
        process.platform === "win32" &&
        newName.toLocaleLowerCase() === currentName.toLocaleLowerCase() &&
        newName !== currentName;

      if (!isCaseOnlyRename && (await pathExists(renamedPath))) {
        return NextResponse.json(
          {
            success: false,
            message: "A project with that name already exists.",
          },
          { status: 409 },
        );
      }

      try {
        if (isCaseOnlyRename) {
          let tempPath = "";
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const tempName = `${newName}__tmp__${Date.now()}_${Math.random().toString(16).slice(2)}`;
            const candidate = projectPath(tempName);
            if (!(await pathExists(candidate))) {
              tempPath = candidate;
              break;
            }
          }

          if (!tempPath) {
            throw new Error("Could not prepare a temporary folder name for case-only rename.");
          }

          await fs.rename(currentPath, tempPath);
          await fs.rename(tempPath, renamedPath);
        } else {
          await fs.rename(currentPath, renamedPath);
        }
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            message: projectUpdateErrorMessage(error),
          },
          { status: 500 },
        );
      }

      await updateProjectDataForRename(renamedPath, currentName, newName);
      await appendProjectHistory(renamedPath, {
        type: "project-title-updated",
        title: "Project renamed",
        description: `${currentName} renamed to ${newName}.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: { from: currentName, to: newName },
      });

      return NextResponse.json({
        success: true,
        projectName: newName,
      });
    }

    if (action === "archive") {
      const archiveProjectsPath = path.join(WORKSPACE_PATH, "Archive", "Projects");
      await fs.mkdir(archiveProjectsPath, { recursive: true });

      const archivedPath = path.join(archiveProjectsPath, currentName);

      if (await pathExists(archivedPath)) {
        return NextResponse.json(
          {
            success: false,
            message: "An archived project with that name already exists.",
          },
          { status: 409 },
        );
      }

      await appendProjectHistory(currentPath, {
        type: "project-archived",
        title: "Project archived",
        description: `${currentName} moved to archive.`,
        source: "user",
        relatedFile: null,
        relatedFolder: null,
        metadata: {},
      });

      await fs.rename(currentPath, archivedPath);

      return NextResponse.json({
        success: true,
        projectName: currentName,
      });
    }

    return NextResponse.json(
      {
        success: false,
        message: "Unknown project action.",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("Project update error:", error);

    return NextResponse.json(
      {
        success: false,
        message: projectUpdateErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeWorkspace();

    const body = await request.json();
    let projectName = "";

    try {
      projectName = validateProjectName(String(body.projectName ?? ""));
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error instanceof Error ? error.message : "Invalid project name.",
        },
        { status: 400 },
      );
    }

    const targetPath = projectPath(projectName);

    if (!(await pathExists(targetPath))) {
      return NextResponse.json(
        {
          success: false,
          message: "The project folder could not be found.",
        },
        { status: 404 },
      );
    }

    await fs.rm(targetPath, {
      recursive: true,
      force: false,
    });

    return NextResponse.json({
      success: true,
      projectName,
    });
  } catch (error) {
    console.error("Project deletion error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "The project could not be deleted.",
      },
      { status: 500 },
    );
  }
}
