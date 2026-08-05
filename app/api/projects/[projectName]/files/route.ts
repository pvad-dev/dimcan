import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECTS_ROOT } from "../../../../../lib/workspace-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FOLDERS = ["Photos", "Videos", "Drawings", "Notes", "Documents"] as const;
const ALLOWED_FOLDER_SET = new Set<string>(ALLOWED_FOLDERS);

type ProjectFolder = (typeof ALLOWED_FOLDERS)[number];

type ProjectFileMeta = {
  id: string;
  filename: string;
  type: string;
  size: number;
  uploadedAt: string;
  folder: ProjectFolder;
};

const DRAWING_EXTENSIONS = new Set([
  "pdf",
  "dwg",
  "dxf",
  "dwf",
  "svg",
  "dgn",
  "step",
  "stp",
  "iges",
  "igs",
  "ifc",
]);

const NOTE_EXTENSIONS = new Set(["txt", "md", "rtf", "csv", "log", "note", "notes"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  rtf: "application/rtf",
  csv: "text/csv; charset=utf-8",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

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

function validateProjectName(projectNameRaw: string) {
  const projectName = sanitizePathSegment(projectNameRaw);
  if (!projectName || projectName === "." || projectName === "..") {
    throw new Error("Invalid project name.");
  }
  return projectName;
}

function validateFolderName(folderRaw: unknown): ProjectFolder {
  const folder = sanitizePathSegment(String(folderRaw || ""));
  if (!ALLOWED_FOLDER_SET.has(folder)) {
    throw new Error("Invalid folder name.");
  }
  return folder as ProjectFolder;
}

function validateFilename(filenameRaw: unknown) {
  const cleaned = sanitizePathSegment(path.basename(String(filenameRaw || ""))).replace(/\.+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Invalid filename.");
  }
  return cleaned;
}

function getProjectNameFromRequest(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const match = pathname.match(/\/api\/projects\/([^/]+)\/files\/?$/);
  const segment = match?.[1] ?? "";
  const decoded = decodeURIComponent(segment);
  return validateProjectName(decoded);
}

function ensureWithin(parentPath: string, childPath: string) {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function getProjectPath(projectName: string) {
  const projectPath = path.join(PROJECTS_ROOT, projectName);
  if (!ensureWithin(PROJECTS_ROOT, projectPath)) {
    throw new Error("Invalid project path.");
  }
  return projectPath;
}

function getFolderPath(projectPath: string, folder: ProjectFolder) {
  const folderPath = path.join(projectPath, folder);
  if (!ensureWithin(projectPath, folderPath)) {
    throw new Error("Invalid folder path.");
  }
  return folderPath;
}

function getExtension(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

function getFileType(filename: string, mimeType: string) {
  if (mimeType) {
    return mimeType;
  }

  const ext = getExtension(filename);
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }

  if (ext) {
    return `application/${ext}`;
  }

  return "application/octet-stream";
}

function classifyFolder(filename: string, mimeType: string): ProjectFolder {
  const lowerType = mimeType.toLowerCase();
  const ext = getExtension(filename);
  const lowerName = filename.toLowerCase();

  if (lowerType.startsWith("image/")) {
    return "Photos";
  }

  if (lowerType.startsWith("video/")) {
    return "Videos";
  }

  if (
    lowerType === "application/pdf" ||
    lowerType.includes("cad") ||
    lowerType.includes("drawing") ||
    DRAWING_EXTENSIONS.has(ext)
  ) {
    return "Drawings";
  }

  if (
    lowerType.startsWith("text/") ||
    lowerType.includes("markdown") ||
    lowerType.includes("rtf") ||
    lowerType.includes("csv") ||
    NOTE_EXTENSIONS.has(ext) ||
    lowerName.includes("note")
  ) {
    return "Notes";
  }

  return "Documents";
}

async function ensureProjectFolders(projectPath: string) {
  await Promise.all(
    ALLOWED_FOLDERS.map(async (folder) => {
      const folderPath = getFolderPath(projectPath, folder);
      await fs.mkdir(folderPath, { recursive: true });
    }),
  );
}

async function buildFileMeta(folderPath: string, folder: ProjectFolder, filename: string): Promise<ProjectFileMeta> {
  const filePath = path.join(folderPath, filename);
  if (!ensureWithin(folderPath, filePath)) {
    throw new Error("Invalid file path.");
  }

  const stat = await fs.stat(filePath);
  const uploadedAt = stat.mtime.toISOString();

  return {
    id: `${folder}:${filename}:${stat.mtimeMs}`,
    filename,
    type: getFileType(filename, ""),
    size: stat.size,
    uploadedAt,
    folder,
  };
}

async function getUniqueDestination(folderPath: string, filename: string) {
  const parsed = path.parse(filename);
  const base = parsed.name || "file";
  const ext = parsed.ext;

  let candidate = `${base}${ext}`;
  let index = 1;

  while (true) {
    const candidatePath = path.join(folderPath, candidate);
    if (!ensureWithin(folderPath, candidatePath)) {
      throw new Error("Invalid destination path.");
    }

    try {
      await fs.access(candidatePath);
      candidate = `${base} (${index})${ext}`;
      index += 1;
    } catch {
      return { filename: candidate, filePath: candidatePath };
    }
  }
}

function shouldRenderInline(contentType: string, filename: string) {
  const lowerType = contentType.toLowerCase();
  if (lowerType.startsWith("image/")) {
    return true;
  }

  const ext = getExtension(filename);
  return ext === "pdf" || lowerType === "application/pdf";
}

function encodeContentDispositionFilename(filename: string) {
  return encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, "%2A");
}

export async function GET(request: NextRequest) {
  try {
    const projectName = getProjectNameFromRequest(request);
    const projectPath = getProjectPath(projectName);

    const folderParam = request.nextUrl.searchParams.get("folder");
    const filenameParam = request.nextUrl.searchParams.get("filename");

    if (folderParam || filenameParam) {
      if (!folderParam || !filenameParam) {
        return errorResponse(400, "Both folder and filename are required.");
      }

      const folder = validateFolderName(folderParam);
      const filename = validateFilename(filenameParam);
      const folderPath = getFolderPath(projectPath, folder);
      const filePath = path.join(folderPath, filename);

      if (!ensureWithin(folderPath, filePath)) {
        return errorResponse(400, "Invalid file path.");
      }

      const buffer = await fs.readFile(filePath);
      const contentType = getFileType(filename, "");
      const dispositionType = shouldRenderInline(contentType, filename) ? "inline" : "attachment";
      const encodedFilename = encodeContentDispositionFilename(filename);

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-length": String(buffer.length),
          "content-disposition": `${dispositionType}; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
          "x-content-type-options": "nosniff",
        },
      });
    }

    await ensureProjectFolders(projectPath);

    const files: ProjectFileMeta[] = [];

    for (const folder of ALLOWED_FOLDERS) {
      const folderPath = getFolderPath(projectPath, folder);
      const entries = await fs.readdir(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const filename = validateFilename(entry.name);
        const meta = await buildFileMeta(folderPath, folder, filename);
        files.push(meta);
      }
    }

    files.sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));

    return NextResponse.json({
      success: true,
      files,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return errorResponse(404, "File not found.");
    }

    const message = error instanceof Error ? error.message : "Failed to list files.";
    const status =
      message === "Invalid project name." ||
      message === "Invalid project path." ||
      message === "Invalid folder name." ||
      message === "Invalid filename." ||
      message === "Invalid file path." ||
      message === "Both folder and filename are required."
        ? 400
        : 500;

    return errorResponse(status, message);
  }
}

export async function POST(request: NextRequest) {
  try {
    const projectName = getProjectNameFromRequest(request);
    const projectPath = getProjectPath(projectName);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(400, "Request must be multipart/form-data.");
    }

    await ensureProjectFolders(projectPath);

    const formData = await request.formData();
    const files = formData.getAll("files").filter(
      (entry): entry is File => entry instanceof File,
    );

    if (!files.length) {
      return errorResponse(400, "No files were uploaded.");
    }

    const savedFiles: ProjectFileMeta[] = [];

    for (const file of files) {
      const safeOriginalName = validateFilename(file.name);
      const folder = classifyFolder(safeOriginalName, file.type || "");
      const folderPath = getFolderPath(projectPath, folder);

      const { filename, filePath } = await getUniqueDestination(folderPath, safeOriginalName);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      const stat = await fs.stat(filePath);
      savedFiles.push({
        id: `${folder}:${filename}:${stat.mtimeMs}`,
        filename,
        type: getFileType(filename, file.type || ""),
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
        folder,
      });
    }

    savedFiles.sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));

    return NextResponse.json({
      success: true,
      files: savedFiles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The upload failed.";
    const status =
      message === "Invalid project name." ||
      message === "Invalid project path." ||
      message === "Invalid filename."
        ? 400
        : 500;

    return errorResponse(status, message);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const projectName = getProjectNameFromRequest(request);
    const projectPath = getProjectPath(projectName);

    const body = (await request.json()) as { filename?: string; folder?: string };
    const filename = validateFilename(body.filename ?? "");
    const folder = validateFolderName(body.folder ?? "");
    const folderPath = getFolderPath(projectPath, folder);
    const filePath = path.join(folderPath, filename);

    if (!ensureWithin(folderPath, filePath)) {
      return errorResponse(400, "Invalid file path.");
    }

    await fs.unlink(filePath);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return errorResponse(404, "File not found.");
    }

    const message = error instanceof Error ? error.message : "Failed to delete file.";
    const status =
      message === "Invalid project name." ||
      message === "Invalid project path." ||
      message === "Invalid folder name." ||
      message === "Invalid filename." ||
      message === "Invalid file path."
        ? 400
        : 500;

    return errorResponse(status, message);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const projectName = getProjectNameFromRequest(request);
    const projectPath = getProjectPath(projectName);
    await ensureProjectFolders(projectPath);

    const body = (await request.json()) as {
      action?: string;
      filename?: string;
      folder?: string;
      newFilename?: string;
      targetFolder?: string;
    };

    const action = String(body.action || "");

    if (action === "rename") {
      const folder = validateFolderName(body.folder ?? "");
      const filename = validateFilename(body.filename ?? "");
      const requestedNewFilename = validateFilename(body.newFilename ?? "");

      const originalExt = path.extname(filename);
      const requestedExt = path.extname(requestedNewFilename);
      const newFilename = requestedExt
        ? requestedNewFilename
        : `${path.parse(requestedNewFilename).name}${originalExt}`;

      if (newFilename === filename) {
        return errorResponse(400, "New filename must be different.");
      }

      const folderPath = getFolderPath(projectPath, folder);
      const sourcePath = path.join(folderPath, filename);
      const destinationPath = path.join(folderPath, newFilename);

      if (!ensureWithin(folderPath, sourcePath) || !ensureWithin(folderPath, destinationPath)) {
        return errorResponse(400, "Invalid file path.");
      }

      try {
        await fs.access(destinationPath);
        return errorResponse(409, "A file with that name already exists.");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      await fs.rename(sourcePath, destinationPath);
      const file = await buildFileMeta(folderPath, folder, newFilename);

      return NextResponse.json({
        success: true,
        file,
      });
    }

    if (action === "move") {
      const folder = validateFolderName(body.folder ?? "");
      const targetFolder = validateFolderName(body.targetFolder ?? "");
      const filename = validateFilename(body.filename ?? "");

      if (folder === targetFolder) {
        return errorResponse(400, "File is already in that folder.");
      }

      const sourceFolderPath = getFolderPath(projectPath, folder);
      const targetFolderPath = getFolderPath(projectPath, targetFolder);
      const sourcePath = path.join(sourceFolderPath, filename);
      const destinationPath = path.join(targetFolderPath, filename);

      if (!ensureWithin(sourceFolderPath, sourcePath) || !ensureWithin(targetFolderPath, destinationPath)) {
        return errorResponse(400, "Invalid file path.");
      }

      try {
        await fs.access(destinationPath);
        return errorResponse(409, "A file with that name already exists in the destination folder.");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      await fs.rename(sourcePath, destinationPath);
      const file = await buildFileMeta(targetFolderPath, targetFolder, filename);

      return NextResponse.json({
        success: true,
        file,
      });
    }

    return errorResponse(400, "Unknown file action.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return errorResponse(404, "File not found.");
    }

    const message = error instanceof Error ? error.message : "Failed to update file.";
    const status =
      message === "Invalid project name." ||
      message === "Invalid project path." ||
      message === "Invalid folder name." ||
      message === "Invalid filename." ||
      message === "Invalid file path." ||
      message === "New filename must be different." ||
      message === "File is already in that folder." ||
      message === "Unknown file action."
        ? 400
        : 500;

    return errorResponse(status, message);
  }
}
