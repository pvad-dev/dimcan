import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_PATH = String.raw`K:\RenovationPlatform\Dimcan Workspace`;

const STANDARD_FOLDERS = [
  "Projects",
  "Clients",
  "Suppliers",
  "Templates",
  "Price Lists",
  "Standards",
  "AI Knowledge",
  "Archive",
];

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
  return projectName
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\.+$/g, "");
}

function projectPath(projectName: string) {
  return path.join(WORKSPACE_PATH, "Projects", projectName);
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
    const projectName = cleanProjectName(body.projectName ?? "");

    if (!projectName) {
      return NextResponse.json(
        {
          success: false,
          message: "Enter a project name.",
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
    const currentName = cleanProjectName(body.projectName ?? "");

    if (!currentName) {
      return NextResponse.json(
        {
          success: false,
          message: "The project name is missing.",
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
      const newName = cleanProjectName(body.newProjectName ?? "");

      if (!newName) {
        return NextResponse.json(
          {
            success: false,
            message: "Enter a new project name.",
          },
          { status: 400 },
        );
      }

      const renamedPath = projectPath(newName);

      if (await pathExists(renamedPath)) {
        return NextResponse.json(
          {
            success: false,
            message: "A project with that name already exists.",
          },
          { status: 409 },
        );
      }

      await fs.rename(currentPath, renamedPath);
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
        message:
          error instanceof Error
            ? error.message
            : "The project could not be updated.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeWorkspace();

    const body = await request.json();
    const projectName = cleanProjectName(body.projectName ?? "");

    if (!projectName) {
      return NextResponse.json(
        {
          success: false,
          message: "The project name is missing.",
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
