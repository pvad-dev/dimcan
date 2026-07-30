"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ArchiveResponse = {
  success: boolean;
  workspacePath?: string;
  projects?: string[];
  message?: string;
};

type RestoreResponse = {
  success: boolean;
  projectName?: string;
  message?: string;
};

export default function ArchivePage() {
  const [archive, setArchive] = useState<ArchiveResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function loadArchive() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/workspace?view=archive", {
        cache: "no-store",
      });

      const data: ArchiveResponse = await response.json();
      setArchive(data);
    } catch {
      setArchive({
        success: false,
        message: "The archive could not be opened.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function restoreProject(project: string) {
    const confirmed = window.confirm(
      `Restore "${project}" to the active Projects list?`,
    );

    if (!confirmed) return;

    setBusyProject(project);
    setMessage("");

    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "restore",
          projectName: project,
        }),
      });

      const data: RestoreResponse = await response.json();

      if (!response.ok) {
        setMessage(data.message ?? "The project could not be restored.");
        return;
      }

      await loadArchive();
    } catch {
      setMessage("The project could not be restored.");
    } finally {
      setBusyProject(null);
    }
  }

  useEffect(() => {
    void loadArchive();
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
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginBottom: "24px",
            color: "#766b5d",
            textDecoration: "none",
          }}
        >
          ← Back to Workspace
        </Link>

        <header style={{ marginBottom: "28px" }}>
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
            Archived Projects
          </h1>
        </header>

        {message && (
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

        {isLoading && <p>Opening archive...</p>}

        {!isLoading && archive?.success === false && (
          <section
            style={{
              background: "#fffaf2",
              border: "1px solid #c9988d",
              borderRadius: "12px",
              padding: "20px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Archive could not open</h2>
            <p>{archive.message}</p>

            <button
              type="button"
              onClick={() => void loadArchive()}
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

        {!isLoading && archive?.success && (
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
                Archive location
              </p>
              <strong>{archive.workspacePath}</strong>
            </section>

            {archive.projects?.length ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "14px",
                }}
              >
                {archive.projects.map((project) => {
                  const isBusy = busyProject === project;

                  return (
                    <article
                      key={project}
                      style={{
                        background: "#fffaf2",
                        border: "1px solid #d8cdbc",
                        borderRadius: "12px",
                        padding: "20px",
                        opacity: isBusy ? 0.65 : 1,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "30px",
                          marginBottom: "12px",
                        }}
                      >
                        🗃️
                      </div>

                      <strong>{project}</strong>

                      <p
                        style={{
                          margin: "8px 0 16px",
                          color: "#766b5d",
                          fontSize: "14px",
                        }}
                      >
                        {isBusy ? "Restoring..." : "Archived project"}
                      </p>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void restoreProject(project)}
                        style={{
                          border: "none",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          background: "#594f43",
                          color: "#ffffff",
                          cursor: isBusy ? "default" : "pointer",
                          opacity: isBusy ? 0.7 : 1,
                        }}
                      >
                        Restore
                      </button>
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
                <strong>No archived projects</strong>
                <p
                  style={{
                    marginBottom: 0,
                    color: "#766b5d",
                  }}
                >
                  Projects you archive will appear here.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
