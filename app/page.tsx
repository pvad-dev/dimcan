"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildSuggestedProjectName } from "../lib/project-understanding";

type WorkspaceResponse = {
  success: boolean;
  workspacePath?: string;
  projects?: string[];
  message?: string;
};

type ProjectActionResponse = {
  success: boolean;
  projectName?: string;
  message?: string;
};

export default function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectNotes, setProjectNotes] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadWorkspace() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
      });

      const data: WorkspaceResponse = await response.json();
      setWorkspace(data);
    } catch {
      setWorkspace({
        success: false,
        message: "The app could not connect to the workspace.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const suggestedProjectName = useMemo(
    () =>
      buildSuggestedProjectName(
        uploadedFiles.map((file) => ({
          filename: file.name,
          type: file.type,
        })),
        projectNotes,
        projectName,
      ),
    [projectName, projectNotes, uploadedFiles],
  );

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadedFiles((current) => [...current, ...Array.from(files)]);
  };

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsCreating(true);
    setMessage("");

    const finalProjectName =
      (projectName || suggestedProjectName).trim() || "Untitled Project";

    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectName: finalProjectName,
        }),
      });

      const data: ProjectActionResponse = await response.json();

      if (!response.ok) {
        setMessage(data.message ?? "The project could not be created.");
        return;
      }

      setProjectName("");
      setProjectNotes("");
      setUploadedFiles([]);
      setShowNewProject(false);

      await loadWorkspace();
    } catch {
      setMessage("The project could not be created.");
    } finally {
      setIsCreating(false);
    }
  }

  async function renameProject(currentName: string) {
    const requestedName = window.prompt("New project name:", currentName);
    const newName = requestedName?.trim();

    if (!newName || newName === currentName) {
      setOpenMenu(null);
      return;
    }

    setBusyProject(currentName);
    setMessage("");

    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "rename",
          projectName: currentName,
          newProjectName: newName,
        }),
      });

      const data: ProjectActionResponse = await response.json();

      if (!response.ok) {
        setMessage(data.message ?? "The project could not be renamed.");
        return;
      }

      await loadWorkspace();
    } catch {
      setMessage("The project could not be renamed.");
    } finally {
      setBusyProject(null);
      setOpenMenu(null);
    }
  }

  async function archiveProject(project: string) {
    const confirmed = window.confirm(
      `Archive "${project}"?\n\nIt will be moved out of the active Projects list.`,
    );

    if (!confirmed) {
      setOpenMenu(null);
      return;
    }

    setBusyProject(project);
    setMessage("");

    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "archive",
          projectName: project,
        }),
      });

      const data: ProjectActionResponse = await response.json();

      if (!response.ok) {
        setMessage(data.message ?? "The project could not be archived.");
        return;
      }

      await loadWorkspace();
    } catch {
      setMessage("The project could not be archived.");
    } finally {
      setBusyProject(null);
      setOpenMenu(null);
    }
  }

  async function deleteProject(project: string) {
    const confirmed = window.confirm(
      `Permanently delete "${project}"?\n\nThis deletes the project folder and everything inside it. This cannot be undone.`,
    );

    if (!confirmed) {
      setOpenMenu(null);
      return;
    }

    setBusyProject(project);
    setMessage("");

    try {
      const response = await fetch("/api/workspace", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectName: project,
        }),
      });

      const data: ProjectActionResponse = await response.json();

      if (!response.ok) {
        setMessage(data.message ?? "The project could not be deleted.");
        return;
      }

      await loadWorkspace();
    } catch {
      setMessage("The project could not be deleted.");
    } finally {
      setBusyProject(null);
      setOpenMenu(null);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  return (
    <main
      onClick={() => setOpenMenu(null)}
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
          maxWidth: "1000px",
          margin: "0 auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "20px",
            marginBottom: "32px",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 8px",
                color: "#766b5d",
                fontSize: "14px",
              }}
            >
              Dimcan Platform
            </p>

            <h1
              style={{
                margin: 0,
                fontSize: "36px",
                fontWeight: 600,
              }}
            >
              Workspace
            </h1>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Link
              href="/assembly-library"
              style={{
                border: "1px solid #b8aa98",
                borderRadius: "9px",
                padding: "12px 18px",
                background: "#fffaf2",
                color: "#2f2a24",
                textDecoration: "none",
                fontSize: "15px",
                fontWeight: 600,
              }}
            >
              Assembly Library
            </Link>

            <Link
              href="/archive"
              style={{
                border: "1px solid #b8aa98",
                borderRadius: "9px",
                padding: "12px 18px",
                background: "#fffaf2",
                color: "#2f2a24",
                textDecoration: "none",
                fontSize: "15px",
                fontWeight: 600,
              }}
            >
              Archived Projects
            </Link>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowNewProject(true);
                setMessage("");
              }}
              style={{
                border: "none",
                borderRadius: "9px",
                padding: "12px 18px",
                background: "#594f43",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: 600,
              }}
            >
              New Project
            </button>
          </div>
        </header>

        {showNewProject && (
          <section
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "#fffaf2",
              border: "1px solid #d8cdbc",
              borderRadius: "12px",
              padding: "20px",
              marginBottom: "28px",
            }}
          >
            <form onSubmit={createProject}>
              <div
                onClick={openFilePicker}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    openFilePicker();
                  }
                }}
                style={{
                  border: "2px dashed #d8cdbc",
                  borderRadius: "12px",
                  padding: "24px",
                  background: "#f8f1e5",
                  cursor: "pointer",
                  marginBottom: "16px",
                  textAlign: "center",
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
                    fontSize: "18px",
                    fontWeight: 700,
                    marginBottom: "6px",
                  }}
                >
                  Upload files to start a project
                </div>
                <div style={{ color: "#766b5d" }}>
                  Drag and drop files here or choose files from your device.
                </div>
              </div>

              {uploadedFiles.length > 0 && (
                <div style={{ marginBottom: "12px", color: "#766b5d" }}>
                  <strong>Selected files:</strong>{" "}
                  {uploadedFiles.map((file) => file.name).join(", ")}
                </div>
              )}

              <label
                htmlFor="projectNotes"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: 600,
                }}
              >
                Quick notes
              </label>

              <textarea
                id="projectNotes"
                value={projectNotes}
                onChange={(event) => setProjectNotes(event.target.value)}
                placeholder="Add a few notes to help generate a project name and understanding..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #b8aa98",
                  borderRadius: "8px",
                  padding: "12px",
                  minHeight: "100px",
                  marginBottom: "12px",
                }}
              />

              <label
                htmlFor="projectName"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: 600,
                }}
              >
                Optional project name
              </label>

              <input
                id="projectName"
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Example: Master Ensuite"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #b8aa98",
                  borderRadius: "8px",
                  padding: "12px",
                  fontSize: "16px",
                  marginBottom: "12px",
                }}
              />

              <div
                style={{
                  marginBottom: "12px",
                  padding: "10px 12px",
                  background: "#f5eddf",
                  borderRadius: "8px",
                  border: "1px solid #e7dbca",
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    color: "#766b5d",
                    marginBottom: "4px",
                  }}
                >
                  AI prototype suggestion
                </div>
                <div style={{ fontWeight: 700 }}>
                  Suggested project name: {suggestedProjectName}
                </div>
              </div>

              {message && (
                <p
                  style={{
                    marginTop: 0,
                    color: "#9a3f32",
                  }}
                >
                  {message}
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                }}
              >
                <button
                  type="submit"
                  disabled={isCreating}
                  style={{
                    border: "none",
                    borderRadius: "8px",
                    padding: "10px 16px",
                    background: "#594f43",
                    color: "#ffffff",
                    cursor: isCreating ? "default" : "pointer",
                    opacity: isCreating ? 0.7 : 1,
                  }}
                >
                  {isCreating ? "Creating..." : "Create Project"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowNewProject(false);
                    setProjectName("");
                    setProjectNotes("");
                    setUploadedFiles([]);
                    setMessage("");
                  }}
                  style={{
                    border: "1px solid #b8aa98",
                    borderRadius: "8px",
                    padding: "10px 16px",
                    background: "transparent",
                    color: "#2f2a24",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {message && !showNewProject && (
          <p
            style={{
              background: "#fffaf2",
              border: "1px solid #c9988d",
              borderRadius: "9px",
              padding: "12px",
              color: "#9a3f32",
            }}
          >
            {message}
          </p>
        )}

        {isLoading && <p>Opening Dimcan Workspace...</p>}

        {!isLoading && workspace?.success === false && (
          <section
            style={{
              background: "#fffaf2",
              border: "1px solid #c9988d",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Workspace could not open</h2>

            <p>{workspace.message}</p>

            <button
              type="button"
              onClick={() => void loadWorkspace()}
              style={{
                border: "none",
                borderRadius: "8px",
                padding: "10px 16px",
                background: "#594f43",
                color: "#ffffff",
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </section>
        )}

        {!isLoading && workspace?.success && (
          <>
            <section
              style={{
                background: "#fffaf2",
                border: "1px solid #d8cdbc",
                borderRadius: "12px",
                padding: "20px",
                marginBottom: "30px",
              }}
            >
              <p
                style={{
                  margin: "0 0 6px",
                  color: "#766b5d",
                  fontSize: "14px",
                }}
              >
                Workspace location
              </p>

              <strong>{workspace.workspacePath}</strong>
            </section>

            <section>
              <h2
                style={{
                  marginBottom: "16px",
                  fontSize: "22px",
                }}
              >
                Projects
              </h2>

              {workspace.projects?.length ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "14px",
                  }}
                >
                  {workspace.projects.map((project) => {
                    const isBusy = busyProject === project;

                    return (
                      <article
                        key={project}
                        style={{
                          position: "relative",
                          background: "#fffaf2",
                          border: "1px solid #d8cdbc",
                          borderRadius: "12px",
                          opacity: isBusy ? 0.65 : 1,
                        }}
                      >
                        <Link
                          href={`/projects/${encodeURIComponent(project)}`}
                          style={{
                            display: "block",
                            minHeight: "130px",
                            padding: "20px",
                            color: "#2f2a24",
                            textDecoration: "none",
                            cursor: isBusy ? "default" : "pointer",
                            pointerEvents: isBusy ? "none" : "auto",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "30px",
                              marginBottom: "12px",
                            }}
                          >
                            📁
                          </div>

                          <strong>{project}</strong>

                          <p
                            style={{
                              margin: "8px 0 0",
                              color: "#766b5d",
                              fontSize: "14px",
                            }}
                          >
                            {isBusy ? "Working..." : "Open project"}
                          </p>
                        </Link>

                        <button
                          type="button"
                          aria-label={`Project options for ${project}`}
                          disabled={isBusy}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpenMenu((current) =>
                              current === project ? null : project,
                            );
                          }}
                          style={{
                            position: "absolute",
                            top: "10px",
                            right: "10px",
                            width: "34px",
                            height: "34px",
                            border: "1px solid #d8cdbc",
                            borderRadius: "8px",
                            background: "#fffaf2",
                            color: "#594f43",
                            cursor: isBusy ? "default" : "pointer",
                            fontSize: "22px",
                            lineHeight: 1,
                          }}
                        >
                          ⋯
                        </button>

                        {openMenu === project && (
                          <div
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              position: "absolute",
                              top: "50px",
                              right: "10px",
                              zIndex: 10,
                              width: "150px",
                              overflow: "hidden",
                              background: "#ffffff",
                              border: "1px solid #d8cdbc",
                              borderRadius: "9px",
                              boxShadow: "0 8px 24px rgba(47, 42, 36, 0.15)",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => void renameProject(project)}
                              style={menuButtonStyle}
                            >
                              Rename
                            </button>

                            <button
                              type="button"
                              onClick={() => void archiveProject(project)}
                              style={menuButtonStyle}
                            >
                              Archive
                            </button>

                            <button
                              type="button"
                              onClick={() => void deleteProject(project)}
                              style={{
                                ...menuButtonStyle,
                                color: "#9a3f32",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    background: "#fffaf2",
                    border: "1px dashed #b8aa98",
                    borderRadius: "12px",
                    padding: "28px",
                  }}
                >
                  <strong>No projects yet</strong>

                  <p
                    style={{
                      marginBottom: 0,
                      color: "#766b5d",
                    }}
                  >
                    Create your first project using the New Project button.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const menuButtonStyle = {
  display: "block",
  width: "100%",
  border: "none",
  borderBottom: "1px solid #eee4d7",
  padding: "11px 13px",
  background: "#ffffff",
  color: "#2f2a24",
  cursor: "pointer",
  textAlign: "left" as const,
  fontSize: "14px",
};
