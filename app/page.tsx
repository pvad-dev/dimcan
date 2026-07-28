"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type WorkspaceResponse = {
  success: boolean;
  workspacePath?: string;
  projects?: string[];
  message?: string;
};

type CreateProjectResponse = {
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
  const [message, setMessage] = useState("");

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

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsCreating(true);
    setMessage("");

    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectName,
        }),
      });

      const data: CreateProjectResponse = await response.json();

      if (!response.ok) {
        setMessage(data.message ?? "The project could not be created.");
        return;
      }

      setProjectName("");
      setShowNewProject(false);

      await loadWorkspace();
    } catch {
      setMessage("The project could not be created.");
    } finally {
      setIsCreating(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

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

          <button
            type="button"
            onClick={() => {
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
        </header>

        {showNewProject && (
          <section
            style={{
              background: "#fffaf2",
              border: "1px solid #d8cdbc",
              borderRadius: "12px",
              padding: "20px",
              marginBottom: "28px",
            }}
          >
            <form onSubmit={createProject}>
              <label
                htmlFor="projectName"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: 600,
                }}
              >
                Project name
              </label>

              <input
                id="projectName"
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Example: Master Ensuite"
                autoFocus
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
                  {workspace.projects.map((project) => (
                    <Link
                      key={project}
                      href={`/projects/${encodeURIComponent(project)}`}
                      style={{
                        display: "block",
                        background: "#fffaf2",
                        border: "1px solid #d8cdbc",
                        borderRadius: "12px",
                        padding: "20px",
                        color: "#2f2a24",
                        textDecoration: "none",
                        cursor: "pointer",
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
                        Open project
                      </p>
                    </Link>
                  ))}
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