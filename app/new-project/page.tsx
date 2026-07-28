import Link from "next/link";

export default function NewProjectPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f4f4f5",
        padding: "40px",
        fontFamily: "Arial, sans-serif",
        color: "#18181b",
      }}
    >
      <div
        style={{
          maxWidth: "700px",
          margin: "0 auto",
          background: "white",
          padding: "32px",
          borderRadius: "12px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginBottom: "24px",
            color: "#52525b",
            textDecoration: "none",
          }}
        >
          ← Back to projects
        </Link>

        <h1 style={{ marginTop: 0 }}>New Project</h1>

        <form style={{ display: "grid", gap: "20px" }}>
          <label>
            <div style={{ marginBottom: "8px" }}>Project name</div>
            <input
              type="text"
              placeholder="Millington Bathrooms"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                border: "1px solid #d4d4d8",
                borderRadius: "8px",
                fontSize: "16px",
              }}
            />
          </label>

          <label>
            <div style={{ marginBottom: "8px" }}>Client name</div>
            <input
              type="text"
              placeholder="Client or contractor name"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                border: "1px solid #d4d4d8",
                borderRadius: "8px",
                fontSize: "16px",
              }}
            />
          </label>

          <label>
            <div style={{ marginBottom: "8px" }}>Project address</div>
            <input
              type="text"
              placeholder="Project address"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                border: "1px solid #d4d4d8",
                borderRadius: "8px",
                fontSize: "16px",
              }}
            />
          </label>

          <label>
            <div style={{ marginBottom: "8px" }}>Upload drawings</div>
            <input type="file" accept=".pdf" />
          </label>

          <button
            type="submit"
            style={{
              background: "#18181b",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "14px 22px",
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            Create Project
          </button>
        </form>
      </div>
    </main>
  );
}