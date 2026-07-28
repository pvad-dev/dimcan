import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_PATH = String.raw`K:\RenovationPlatform\Dimcan Workspace`;

function cleanProjectName(projectName: string) {
  return projectName
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\.+$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const projectName = cleanProjectName(
      request.nextUrl.pathname.split("/").slice(-3, -2)[0] || "",
    );

    if (!projectName) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid project name.",
        },
        { status: 400 },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json(
        {
          success: false,
          message: "Request must be multipart/form-data.",
        },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter(
      (entry): entry is File => entry instanceof File,
    );

    if (!files.length) {
      return NextResponse.json(
        {
          success: false,
          message: "No files were uploaded.",
        },
        { status: 400 },
      );
    }

    const projectPath = path.join(WORKSPACE_PATH, "Projects", projectName);
    const filesPath = path.join(projectPath, "_files");

    await fs.mkdir(filesPath, { recursive: true });

    const savedFiles = [] as Array<{
      name: string;
      type: string;
      size: number;
    }>;

    for (const file of files) {
      const fileName = file.name.replace(/[<>:"/\\|?*]/g, "");
      const destination = path.join(filesPath, fileName);
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await fs.writeFile(destination, buffer);

      savedFiles.push({
        name: fileName,
        type: file.type || "application/octet-stream",
        size: buffer.length,
      });
    }

    return NextResponse.json({
      success: true,
      files: savedFiles,
    });
  } catch (error) {
    console.error("Upload error:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "The upload failed.",
      },
      { status: 500 },
    );
  }
}
