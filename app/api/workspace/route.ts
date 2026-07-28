import { NextRequest, NextResponse } from "next/server";
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

export async function GET() {
  try {
    const workspace = await initializeWorkspace();

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

    const projectPath = path.join(
      WORKSPACE_PATH,
      "Projects",
      projectName,
    );

    try {
      await fs.access(projectPath);

      return NextResponse.json(
        {
          success: false,
          message: "A project with that name already exists.",
        },
        { status: 409 },
      );
    } catch {
      // The project does not exist, so it can be created.
    }

    await fs.mkdir(projectPath, { recursive: true });

    await Promise.all(
      PROJECT_FOLDERS.map((folderName) =>
        fs.mkdir(path.join(projectPath, folderName), {
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