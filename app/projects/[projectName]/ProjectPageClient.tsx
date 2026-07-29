"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type UploadedFile = {
  name: string;
  type: string;
  size: number;
};

type UploadResponse = {
  success: boolean;
  files?: UploadedFile[];
  message?: string;
};

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

const defaultUnderstanding: ProjectUnderstanding = {
  projectType: "Bathroom Renovation",
  confidence: 94,
  detectedFiles: [
    "2 Drawing PDFs",
    "18 Site Photos",
    "1 Existing Quote",
    "1 Specification",
  ],
  possibleRooms: ["Ensuite", "Main Bathroom"],
  detectedScope: [
    "Demolition",
    "Waterproofing",
    "Floor tile",
    "Wall tile",
    "Heated floor",
    "Shower niche",
  ],
  missingInformation: ["Tile selection", "Grout color", "Waterproofing system"],
};

function mergeUnderstanding(
  aiData: ProjectUnderstanding,
  userEdits: Partial<ProjectUnderstanding>,
): ProjectUnderstanding {
  return {
    projectType: userEdits.projectType ?? aiData.projectType,
    confidence: aiData.confidence,
    detectedFiles: userEdits.detectedFiles ?? aiData.detectedFiles,
    possibleRooms: userEdits.possibleRooms ?? aiData.possibleRooms,
    detectedScope: userEdits.detectedScope ?? aiData.detectedScope,
    missingInformation:
      userEdits.missingInformation ?? aiData.missingInformation,
  };
}

function formatFileSize(size: number) {
  if (size >= 1_000_000) {
    return `${(size / 1_000_000).toFixed(1)} MB`;
  }
  if (size >= 1_000) {
    return `${(size / 1_000).toFixed(1)} KB`;
  }
  return `${size} B`;
}

function formatDateTime(dateTime: string) {
  return new Date(dateTime).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFileCategory(type: string, filename: string) {
  const lowerType = type.toLowerCase();
  const lowerName = filename.toLowerCase();

  if (lowerType === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "PDF";
  }
  if (lowerType.startsWith("image/") || /(jpg|jpeg|png|gif|bmp|webp|svg)$/.test(lowerName)) {
    return "Image";
  }
  if (lowerType.startsWith("video/") || /(mp4|mov|avi|mkv|webm)$/.test(lowerName)) {
    return "Video";
  }
  if (
    lowerType === "application/msword" ||
    lowerType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /(doc|docx)$/.test(lowerName)
  ) {
    return "Document";
  }
  if (
    lowerType === "application/vnd.ms-excel" ||
    lowerType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lowerType === "application/vnd.ms-excel.sheet.macroenabled.12" ||
    /(xls|xlsx|csv)$/.test(lowerName)
  ) {
    return "Spreadsheet";
  }
  return "Other";
}

function getFileIcon(category: string) {
  switch (category) {
    case "PDF":
      return "📄";
    case "Image":
      return "🖼️";
    case "Video":
      return "🎬";
    case "Document":
      return "📝";
    case "Spreadsheet":
      return "📊";
    default:
      return "📁";
  }
}

function generateMockProjectNameSuggestions(
  projectFiles: ProjectFileMeta[],
  projectName: string,
) {
  if (projectFiles.length === 0) {
    return [];
  }

  const names = projectFiles
    .flatMap((file) => file.filename.split(/[^a-zA-Z0-9]+/))
    .filter(Boolean)
    .map((word) => word.replace(/\W/g, ""))
    .filter((word) => word.length >= 4);

  const firstWord =
    names.find((word) => /^[A-Za-z]/.test(word)) ||
    projectName.split(/[^a-zA-Z0-9]+/).filter(Boolean)[0] ||
    "Project";

  const roomMatch = projectFiles.some((file) => /ensuite|bathroom|kitchen|bedroom|master/i.test(file.filename))
    ? "Ensuite"
    : "Bathroom";

  const scopeMatch = projectFiles.some((file) => /tile|floor|waterproof|shower|bath|plumbing/i.test(file.filename))
    ? "Tile Scope"
    : "Renovation";

  const location = `${firstWord}`;

  return [
    `${location} ${roomMatch} Renovation`,
    `${location} ${scopeMatch} Project`,
    `Master ${roomMatch} ${scopeMatch}`,
  ];
}

export default function ProjectPageClient({ projectName }: { projectName: string }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [projectFiles, setProjectFiles] = useState<ProjectFileMeta[]>([]);
  const [projectTitle, setProjectTitle] = useState(projectName);
  const [titleDraft, setTitleDraft] = useState(projectName);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [hasSelectedTitle, setHasSelectedTitle] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [activity, setActivity] = useState<string[]>([
    "Project created",
    "Waiting for project information",
  ]);
  const [dragActive, setDragActive] = useState(false);
  const [hoverActive, setHoverActive] = useState(false);
  const [uploadDots, setUploadDots] = useState(".");
  const [isEditingUnderstanding, setIsEditingUnderstanding] = useState(false);
  const [aiUnderstanding] = useState<ProjectUnderstanding>(defaultUnderstanding);
  const [userUnderstanding, setUserUnderstanding] = useState<
    Partial<ProjectUnderstanding>
  >({});
  const [editingUnderstanding, setEditingUnderstanding] = useState<
    ProjectUnderstanding
  >(defaultUnderstanding);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const previousTitleRef = useRef(projectName);

  const storageKey = `dimcan:projectUnderstanding:${projectName}`;
  const fileStorageKey = `dimcan:projectFiles:${projectName}`;
  const titleStorageKey = `dimcan:projectTitle:${projectName}`;

  // Load saved user edits from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProjectUnderstanding>;
        setUserUnderstanding(parsed);
      }
    } catch (e) {
      // ignore parse errors
      // console.warn("Failed to load project understanding from localStorage", e);
    }

    try {
      const rawFiles = localStorage.getItem(fileStorageKey);
      if (rawFiles) {
        const parsedFiles = JSON.parse(rawFiles) as ProjectFileMeta[];
        setProjectFiles(parsedFiles);
      }
    } catch (e) {
      // ignore parse errors
    }

    try {
      const rawTitle = localStorage.getItem(titleStorageKey);
      if (rawTitle) {
        setProjectTitle(rawTitle);
        setTitleDraft(rawTitle);
        setHasSelectedTitle(true);
        setShowNameSuggestions(false);
      }
    } catch (e) {
      // ignore parse errors
    }
  }, [storageKey, fileStorageKey, titleStorageKey]);

  useEffect(() => {
    if (projectFiles.length > 0 && !hasSelectedTitle) {
      setShowNameSuggestions(true);
    }
  }, [projectFiles.length, hasSelectedTitle]);

  useEffect(() => {
    setTitleDraft(projectTitle);
  }, [projectTitle]);

  useEffect(() => {
    if (!isEditingUnderstanding) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isEditingUnderstanding]);

  const understanding = useMemo(
    () => mergeUnderstanding(aiUnderstanding, userUnderstanding),
    [aiUnderstanding, userUnderstanding],
  );

  useEffect(() => {
    if (!isUploading) {
      setUploadDots(".");
      return;
    }

    const interval = window.setInterval(() => {
      setUploadDots((current) => (current.length === 3 ? "." : `${current}.`));
    }, 400);

    return () => window.clearInterval(interval);
  }, [isUploading]);

  useEffect(() => {
    if (!uploadSuccess) return;

    const timeout = window.setTimeout(() => {
      setUploadSuccess(false);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [uploadSuccess]);

  const projectNameSuggestions = useMemo(
    () => generateMockProjectNameSuggestions(projectFiles, projectName),
    [projectFiles, projectName],
  );

  const activityMessage = useMemo(() => {
    const fileCount = projectFiles.length;
    if (fileCount === 0) return null;
    return `${fileCount} file${fileCount === 1 ? "" : "s"} added`;
  }, [projectFiles]);

  const saveTitleDraft = (draft: string) => {
    const nextTitle = draft.trim() || projectName;
    setProjectTitle(nextTitle);
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    setHasSelectedTitle(true);
    setShowNameSuggestions(false);
    try {
      localStorage.setItem(titleStorageKey, nextTitle);
    } catch (e) {
      // ignore storage errors
    }
  };

  const cancelTitleEdit = () => {
    setTitleDraft(projectTitle);
    setIsEditingTitle(false);
  };

  const selectProjectTitle = (suggestedTitle: string) => {
    saveTitleDraft(suggestedTitle);
  };

  const handleSuggestNames = () => {
    setShowNameSuggestions((current) => !current);
  };

  const startTitleEdit = () => {
    previousTitleRef.current = projectTitle;
    setTitleDraft(projectTitle);
    setIsEditingTitle(true);
    setShowNameSuggestions(false);
  };

  const handleTitleInputBlur = () => {
    if (isEditingTitle) {
      saveTitleDraft(titleDraft);
    }
  };

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const handleTitleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      saveTitleDraft(titleDraft);
    }
    if (event.key === "Escape") {
      cancelTitleEdit();
    }
  };

  const openReviewEdit = () => {
    setEditingUnderstanding(understanding);
    setIsEditingUnderstanding(true);
  };

  const closeReviewEdit = () => {
    setIsEditingUnderstanding(false);
  };

  const updateEditingField = (
    field: keyof ProjectUnderstanding,
    value: string | string[],
  ) => {
    setEditingUnderstanding((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateListItem = (
    field: keyof Pick<
      ProjectUnderstanding,
      "possibleRooms" | "detectedScope" | "missingInformation"
    >,
    index: number,
    value: string,
  ) => {
    setEditingUnderstanding((current) => {
      const list = [...current[field]];
      list[index] = value;
      return { ...current, [field]: list };
    });
  };

  const addListItem = (
    field: keyof Pick<
      ProjectUnderstanding,
      "possibleRooms" | "detectedScope" | "missingInformation"
    >,
  ) => {
    setEditingUnderstanding((current) => ({
      ...current,
      [field]: [...current[field], ""],
    }));
  };

  const removeListItem = (
    field: keyof Pick<
      ProjectUnderstanding,
      "possibleRooms" | "detectedScope" | "missingInformation"
    >,
    index: number,
  ) => {
    setEditingUnderstanding((current) => {
      const list = current[field].filter((_, idx) => idx !== index);
      return { ...current, [field]: list };
    });
  };

  const saveUnderstandingEdits = () => {
    const newUserEdits: Partial<ProjectUnderstanding> = {
      projectType: editingUnderstanding.projectType,
      possibleRooms: editingUnderstanding.possibleRooms,
      detectedScope: editingUnderstanding.detectedScope,
      missingInformation: editingUnderstanding.missingInformation,
    };

    setUserUnderstanding(newUserEdits);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newUserEdits));
    } catch (e) {
      // ignore storage errors
    }

    setIsEditingUnderstanding(false);
  };

  const resetToAISuggestion = () => {
    // Restore the editing view to AI suggestion and remove saved user edits
    setEditingUnderstanding(aiUnderstanding);
    setUserUnderstanding({});
    try {
      localStorage.removeItem(storageKey);
    } catch (e) {
      // ignore
    }
  };

  const handleFiles = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    setUploadError(null);
    setUploadSuccess(false);
    setIsUploading(true);

    try {
      const formData = new FormData();

      Array.from(selectedFiles).forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectName)}/files`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data: UploadResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Upload failed.");
      }

      setFiles((current) => [...current, ...(data.files ?? [])]);

      const newProjectFiles = (data.files ?? []).map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}`,
        filename: file.name,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      }));

      setProjectFiles((current) => {
        const nextFiles = [...current, ...newProjectFiles];
        try {
          localStorage.setItem(fileStorageKey, JSON.stringify(nextFiles));
        } catch (e) {
          // ignore storage errors
        }
        return nextFiles;
      });

      setUploadSuccess(true);

      setActivity((current) => [
        ...current.filter((item) => item !== activityMessage),
        `${data.files?.length ?? 0} file${
          data.files?.length === 1 ? "" : "s"
        } added`,
      ]);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "The upload failed.",
      );
    } finally {
      setIsUploading(false);
      setDragActive(false);
    }
  };

  const deleteProjectFile = (fileId: string) => {
    setProjectFiles((current) => {
      const nextFiles = current.filter((file) => file.id !== fileId);
      try {
        localStorage.setItem(fileStorageKey, JSON.stringify(nextFiles));
      } catch (e) {
        // ignore storage errors
      }
      return nextFiles;
    });
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f4efe5",
        color: "#2f2a24",
        padding: "40px 24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginBottom: "30px",
            color: "#766b5d",
            textDecoration: "none",
          }}
        >
          ← Back to Workspace
        </Link>

        <header
          style={{
            marginBottom: "40px",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              color: "#766b5d",
              fontSize: "14px",
            }}
          >
            Dimcan Project
          </p>

            {isEditingTitle ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  marginBottom: "14px",
                }}
              >
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={handleTitleInputKeyDown}
                  onBlur={handleTitleInputBlur}
                  aria-label="Edit project title"
                  style={{
                    fontSize: "38px",
                    fontWeight: 600,
                    border: "1px solid #d8cdbc",
                    borderRadius: "14px",
                    padding: "12px 16px",
                    width: "100%",
                    maxWidth: "560px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => saveTitleDraft(titleDraft)}
                  style={{
                    border: "1px solid #d8cdbc",
                    borderRadius: "12px",
                    padding: "12px 18px",
                    background: "#fffaf2",
                    color: "#2f2a24",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelTitleEdit}
                  style={{
                    border: "1px solid transparent",
                    borderRadius: "12px",
                    padding: "12px 18px",
                    background: "transparent",
                    color: "#766b5d",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                  marginBottom: "14px",
                }}
              >
                <h1
                  style={{
                    margin: 0,
                    fontSize: "38px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={startTitleEdit}
                >
                  {projectTitle}
                </h1>
                <button
                  type="button"
                  onClick={startTitleEdit}
                  style={{
                    border: "1px solid #d8cdbc",
                    borderRadius: "12px",
                    padding: "12px 18px",
                    background: "#fffaf2",
                    color: "#2f2a24",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                >
                  Edit title
                </button>
              </div>
            )}

            {projectNameSuggestions.length > 0 && (
              <button
                type="button"
                onClick={handleSuggestNames}
                style={{
                  border: "1px solid #d8cdbc",
                  borderRadius: "12px",
                  padding: "10px 16px",
                  background: "#fffaf2",
                  color: "#2f2a24",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 700,
                }}
              >
                {showNameSuggestions ? "Hide suggestions" : "Suggest names"}
              </button>
            )}
          </header>

          <section
            style={{
              background: "#fffaf2",
              border: "1px solid #d8cdbc",
              borderRadius: "18px",
              padding: "60px 30px",
              marginBottom: "36px",
              boxShadow: "0 12px 30px rgba(75, 62, 47, 0.06)",
            }}
          >
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={openFilePicker}
              onMouseEnter={() => setHoverActive(true)}
              onMouseLeave={() => setHoverActive(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openFilePicker();
                }
              }}
              style={{
                border: dragActive
                  ? "2px dashed #594f43"
                  : hoverActive
                  ? "2px dashed #b49c7f"
                  : "2px dashed #d8cdbc",
                borderRadius: "18px",
                padding: "60px 30px",
                background: dragActive
                  ? "#efe4d2"
                  : hoverActive
                  ? "#f7ead6"
                  : "#f8f1e5",
                maxWidth: "680px",
                margin: "0 auto",
                cursor: "pointer",
                transition:
                  "background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease",
                boxShadow: dragActive
                  ? "0 18px 36px rgba(75, 62, 47, 0.12)"
                  : hoverActive
                  ? "0 14px 30px rgba(75, 62, 47, 0.1)"
                  : "none",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => handleFiles(event.target.files)}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: "20px",
              }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: "block" }}
              >
                <path
                  d="M16.59 9.17L13 5.58V15H11V5.58L7.41 9.17L6 7.75L12 1.75L18 7.75L16.59 9.17ZM6 18V20H18V18H6Z"
                  fill="#594f43"
                />
              </svg>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: "24px",
                fontWeight: 600,
                color: "#2f2a24",
              }}
            >
              Upload or drag files here
            </p>

            <p
              style={{
                margin: "14px 0 0",
                color: "#766b5d",
                fontSize: "16px",
                lineHeight: 1.7,
              }}
            >
              Click to browse your computer or drag files into this area.
            </p>

            <p
              style={{
                margin: "14px 0 0",
                color: "#766b5d",
                fontSize: "14px",
                lineHeight: 1.75,
              }}
            >
              Drawings • PDFs • Photos • Videos • Emails • Invoices • Specifications
            </p>

            {isUploading && (
              <p
                style={{
                  marginTop: "24px",
                  color: "#594f43",
                  fontSize: "15px",
                  fontWeight: 600,
                }}
              >
                Uploading files{uploadDots}
              </p>
            )}

            {uploadSuccess && !isUploading && (
              <p
                style={{
                  marginTop: "24px",
                  color: "#375a36",
                  fontSize: "15px",
                  fontWeight: 600,
                }}
              >
                ✓ Files uploaded successfully
              </p>
            )}
          </div>
        </section>

        {projectFiles.length > 0 && (
          <>
            <section
              style={{
                background: "#fffaf2",
                border: "1px solid #d8cdbc",
                borderRadius: "18px",
                padding: "32px",
                marginBottom: "36px",
                boxShadow: "0 12px 30px rgba(75, 62, 47, 0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "20px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <p
                    style={{
                      margin: 0,
                      color: "#766b5d",
                      fontSize: "14px",
                    }}
                  >
                    Project Documents
                  </p>
                  <h2
                    style={{
                      margin: "8px 0 0",
                      fontSize: "28px",
                      fontWeight: 700,
                      color: "#2f2a24",
                    }}
                  >
                    Document library
                  </h2>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "14px",
                  marginTop: "28px",
                }}
              >
                {projectFiles.map((file) => {
                  const category = getFileCategory(file.type, file.filename);
                  return (
                    <div
                      key={file.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: "16px",
                        alignItems: "center",
                        background: "#f8f1e5",
                        border: "1px solid #d8cdbc",
                        borderRadius: "14px",
                        padding: "18px 20px",
                      }}
                    >
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "14px",
                          background: "#fff",
                          display: "grid",
                          placeItems: "center",
                          fontSize: "20px",
                        }}
                      >
                        {getFileIcon(category)}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gap: "4px",
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontSize: "15px",
                            fontWeight: 700,
                            color: "#2f2a24",
                          }}
                        >
                          {file.filename}
                        </p>
                        <p
                          style={{
                            margin: 0,
                            color: "#766b5d",
                            fontSize: "14px",
                          }}
                        >
                          {formatFileSize(file.size)} • {formatDateTime(file.uploadedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteProjectFile(file.id)}
                        style={{
                          border: "1px solid #d8cdbc",
                          borderRadius: "12px",
                          padding: "10px 14px",
                          background: "#fffaf2",
                          color: "#2f2a24",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {projectNameSuggestions.length > 0 && showNameSuggestions && (
              <section
                style={{
                  background: "#fffaf2",
                  border: "1px solid #d8cdbc",
                  borderRadius: "18px",
                  padding: "28px 32px",
                  marginBottom: "36px",
                  boxShadow: "0 12px 30px rgba(75, 62, 47, 0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                    marginBottom: "22px",
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: 0,
                        color: "#766b5d",
                        fontSize: "14px",
                      }}
                    >
                      AI suggestion
                    </p>
                    <h2
                      style={{
                        margin: "8px 0 0",
                        fontSize: "24px",
                        fontWeight: 700,
                        color: "#2f2a24",
                      }}
                    >
                      Suggested project names
                    </h2>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "14px" }}>
                  {projectNameSuggestions.map((suggestion) => (
                    <div
                      key={suggestion}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "16px",
                        background: "#f8f1e5",
                        border: "1px solid #d8cdbc",
                        borderRadius: "14px",
                        padding: "18px 20px",
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          color: "#2f2a24",
                          fontSize: "15px",
                          fontWeight: 700,
                        }}
                      >
                        {suggestion}
                      </p>
                      <button
                        type="button"
                        onClick={() => selectProjectTitle(suggestion)}
                        style={{
                          border: "1px solid #d8cdbc",
                          borderRadius: "12px",
                          padding: "10px 16px",
                          background: "#fffaf2",
                          color: "#2f2a24",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: 700,
                        }}
                      >
                        Use this name
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <section>
          <h2
            style={{
              marginBottom: "18px",
              fontSize: "24px",
              fontWeight: 600,
            }}
          >
            Activity
          </h2>

          <div
            style={{
              display: "grid",
              gap: "18px",
              marginBottom: "28px",
            }}
          >
            {activity.map((item) => (
              <div
                key={item}
                style={{
                  background: "#fffaf2",
                  border: "1px solid #d8cdbc",
                  borderRadius: "14px",
                  padding: "22px 24px",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: "16px",
                    color: "#2f2a24",
                    fontWeight: 600,
                  }}
                >
                  {item}
                </p>
              </div>
            ))}
          </div>

          {uploadError && (
            <div
              style={{
                background: "#fee8e3",
                border: "1px solid #d8ab9d",
                borderRadius: "14px",
                padding: "18px 22px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#9a3f32",
                  fontSize: "15px",
                }}
              >
                {uploadError}
              </p>
            </div>
          )}
        </section>

        {projectFiles.length > 0 && (
          <section
            style={{
              background: "#fffaf2",
              border: "1px solid #d8cdbc",
              borderRadius: "18px",
              padding: "32px",
              marginBottom: "36px",
              boxShadow: "0 12px 30px rgba(75, 62, 47, 0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "20px",
                flexWrap: "wrap",
                alignItems: "flex-start",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    color: "#766b5d",
                    fontSize: "14px",
                  }}
                >
                  Project Understanding
                </p>
                <h2
                  style={{
                    margin: "8px 0 0",
                    fontSize: "28px",
                    fontWeight: 700,
                    color: "#2f2a24",
                  }}
                >
                  Project Understanding
                </h2>
              </div>

              <div
                style={{
                  background: "#f8f1e5",
                  border: "1px solid #d8cdbc",
                  borderRadius: "14px",
                  padding: "16px 20px",
                  minWidth: "180px",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    color: "#766b5d",
                  }}
                >
                  Project type
                </p>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#2f2a24",
                  }}
                >
                  {understanding.projectType}
                </p>
                <p
                  style={{
                    margin: "16px 0 0",
                    fontSize: "14px",
                    color: "#766b5d",
                  }}
                >
                  Confidence
                </p>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#2f2a24",
                  }}
                >
                  {understanding.confidence}%
                </p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: "22px",
                marginTop: "28px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: "14px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: "8px",
                    background: "#f8f1e5",
                    border: "1px solid #d8cdbc",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#2f2a24",
                    }}
                  >
                    Detected files
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "18px",
                      color: "#766b5d",
                      fontSize: "14px",
                      lineHeight: 1.8,
                    }}
                  >
                    {understanding.detectedFiles.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "8px",
                    background: "#f8f1e5",
                    border: "1px solid #d8cdbc",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#2f2a24",
                    }}
                  >
                    Possible rooms
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "18px",
                      color: "#766b5d",
                      fontSize: "14px",
                      lineHeight: 1.8,
                    }}
                  >
                    {understanding.possibleRooms.map((room) => (
                      <li key={room}>{room}</li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "8px",
                    background: "#f8f1e5",
                    border: "1px solid #d8cdbc",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#2f2a24",
                    }}
                  >
                    Detected scope
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "18px",
                      color: "#766b5d",
                      fontSize: "14px",
                      lineHeight: 1.8,
                    }}
                  >
                    {understanding.detectedScope.map((scope) => (
                      <li key={scope}>{scope}</li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "8px",
                    background: "#f8f1e5",
                    border: "1px solid #d8cdbc",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#2f2a24",
                    }}
                  >
                    Possible missing information
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: "18px",
                      color: "#766b5d",
                      fontSize: "14px",
                      lineHeight: 1.8,
                    }}
                  >
                    {understanding.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <button
                  type="button"
                  style={{
                    border: "none",
                    borderRadius: "12px",
                    padding: "14px 20px",
                    background: "#594f43",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontSize: "15px",
                    fontWeight: 700,
                  }}
                >
                  Confirm Project Understanding
                </button>
                <button
                  type="button"
                  onClick={openReviewEdit}
                  style={{
                    border: "1px solid #d8cdbc",
                    borderRadius: "12px",
                    padding: "14px 20px",
                    background: "#fffaf2",
                    color: "#2f2a24",
                    cursor: "pointer",
                    fontSize: "15px",
                    fontWeight: 700,
                  }}
                >
                  Review & Edit
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {isEditingUnderstanding && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(47, 42, 36, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            overflowY: "auto",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "840px",
              maxHeight: "calc(100vh - 32px)",
              display: "flex",
              flexDirection: "column",
              background: "#fffaf2",
              border: "1px solid #d8cdbc",
              borderRadius: "20px",
              boxShadow: "0 24px 48px rgba(75, 62, 47, 0.18)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                padding: "28px 32px 24px",
                borderBottom: "1px solid #e6dac8",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#766b5d",
                  fontSize: "14px",
                }}
              >
                Review & Edit
              </p>
              <h2
                style={{
                  margin: "8px 0 0",
                  fontSize: "28px",
                  fontWeight: 700,
                  color: "#2f2a24",
                }}
              >
                Project Understanding
              </h2>
            </div>

            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflowY: "auto",
                padding: "24px 32px 0",
                display: "grid",
                gap: "24px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: "10px",
                }}
              >
                <label
                  style={{
                    fontSize: "14px",
                    color: "#766b5d",
                    fontWeight: 700,
                  }}
                >
                  Project type
                </label>
                <input
                  value={editingUnderstanding.projectType}
                  onChange={(event) =>
                    updateEditingField("projectType", event.target.value)
                  }
                  style={{
                    width: "100%",
                    border: "1px solid #d8cdbc",
                    borderRadius: "12px",
                    padding: "14px 16px",
                    fontSize: "15px",
                    color: "#2f2a24",
                    background: "#f8f1e5",
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "18px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#2f2a24",
                      }}
                    >
                      Rooms
                    </p>
                    <button
                      type="button"
                      onClick={() => addListItem("possibleRooms")}
                      style={{
                        border: "1px solid #d8cdbc",
                        borderRadius: "10px",
                        background: "#fffaf2",
                        padding: "10px 14px",
                        color: "#2f2a24",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Add room
                    </button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    {editingUnderstanding.possibleRooms.map((room, index) => (
                      <div
                        key={`${room}-${index}`}
                        style={{
                          display: "grid",
                          gap: "8px",
                          background: "#f8f1e5",
                          border: "1px solid #d8cdbc",
                          borderRadius: "12px",
                          padding: "14px",
                        }}
                      >
                        <input
                          value={room}
                          onChange={(event) =>
                            updateListItem(
                              "possibleRooms",
                              index,
                              event.target.value,
                            )
                          }
                          style={{
                            width: "100%",
                            border: "1px solid #d8cdbc",
                            borderRadius: "10px",
                            padding: "12px 14px",
                            fontSize: "15px",
                            background: "#fff",
                            color: "#2f2a24",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeListItem("possibleRooms", index)}
                          style={{
                            width: "fit-content",
                            border: "none",
                            background: "transparent",
                            color: "#9a3f32",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: 0,
                            alignSelf: "flex-start",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#2f2a24",
                      }}
                    >
                      Scope of work
                    </p>
                    <button
                      type="button"
                      onClick={() => addListItem("detectedScope")}
                      style={{
                        border: "1px solid #d8cdbc",
                        borderRadius: "10px",
                        background: "#fffaf2",
                        padding: "10px 14px",
                        color: "#2f2a24",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Add scope item
                    </button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    {editingUnderstanding.detectedScope.map((scope, index) => (
                      <div
                        key={`${scope}-${index}`}
                        style={{
                          display: "grid",
                          gap: "8px",
                          background: "#f8f1e5",
                          border: "1px solid #d8cdbc",
                          borderRadius: "12px",
                          padding: "14px",
                        }}
                      >
                        <input
                          value={scope}
                          onChange={(event) =>
                            updateListItem(
                              "detectedScope",
                              index,
                              event.target.value,
                            )
                          }
                          style={{
                            width: "100%",
                            border: "1px solid #d8cdbc",
                            borderRadius: "10px",
                            padding: "12px 14px",
                            fontSize: "15px",
                            background: "#fff",
                            color: "#2f2a24",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeListItem("detectedScope", index)}
                          style={{
                            width: "fit-content",
                            border: "none",
                            background: "transparent",
                            color: "#9a3f32",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: 0,
                            alignSelf: "flex-start",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#2f2a24",
                      }}
                    >
                      Missing information
                    </p>
                    <button
                      type="button"
                      onClick={() => addListItem("missingInformation")}
                      style={{
                        border: "1px solid #d8cdbc",
                        borderRadius: "10px",
                        background: "#fffaf2",
                        padding: "10px 14px",
                        color: "#2f2a24",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Add missing item
                    </button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    {editingUnderstanding.missingInformation.map((item, index) => (
                      <div
                        key={`${item}-${index}`}
                        style={{
                          display: "grid",
                          gap: "8px",
                          background: "#f8f1e5",
                          border: "1px solid #d8cdbc",
                          borderRadius: "12px",
                          padding: "14px",
                        }}
                      >
                        <input
                          value={item}
                          onChange={(event) =>
                            updateListItem(
                              "missingInformation",
                              index,
                              event.target.value,
                            )
                          }
                          style={{
                            width: "100%",
                            border: "1px solid #d8cdbc",
                            borderRadius: "10px",
                            padding: "12px 14px",
                            fontSize: "15px",
                            background: "#fff",
                            color: "#2f2a24",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeListItem("missingInformation", index)}
                          style={{
                            width: "fit-content",
                            border: "none",
                            background: "transparent",
                            color: "#9a3f32",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: 0,
                            alignSelf: "flex-start",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                flexShrink: 0,
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
                padding: "0 32px 24px",
                background: "#fffaf2",
                borderTop: "1px solid #e6dac8",
              }}
            >
              <button
                type="button"
                onClick={resetToAISuggestion}
                style={{
                  border: "1px solid #d8cdbc",
                  borderRadius: "12px",
                  padding: "14px 20px",
                  background: "#fffaf2",
                  color: "#2f2a24",
                  cursor: "pointer",
                  fontSize: "15px",
                }}
              >
                Reset to AI Suggestion
              </button>

              <button
                type="button"
                onClick={closeReviewEdit}
                style={{
                  border: "1px solid #d8cdbc",
                  borderRadius: "12px",
                  padding: "14px 20px",
                  background: "#fffaf2",
                  color: "#2f2a24",
                  cursor: "pointer",
                  fontSize: "15px",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveUnderstandingEdits}
                style={{
                  border: "none",
                  borderRadius: "12px",
                  padding: "14px 20px",
                  background: "#594f43",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "15px",
                  fontWeight: 700,
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
