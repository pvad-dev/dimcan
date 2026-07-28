import Link from "next/link";

const projects = [
  {
    name: "Millington Bathrooms",
    client: "Private Client",
    status: "Estimating",
  },
  {
    name: "Corview Tile Repair",
    client: "Corview",
    status: "Pricing",
  },
  {
    name: "Kuik Bathrooms",
    client: "Kuik Residence",
    status: "Draft Quote",
  },
];

export default function Home() {
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
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "36px" }}>
              Dimcan Platform
            </h1>

            <p style={{ marginTop: "8px", color: "#71717a" }}>
              Renovation estimating and project management
            </p>
          </div>

          <Link
            href="/new-project"
            style={{
              background: "#18181b",
              color: "white",
              textDecoration: "none",
              borderRadius: "8px",
              padding: "14px 22px",
              fontSize: "16px",
            }}
          >
            + New Project
          </Link>
        </header>

        <section
          style={{
            background: "white",
            borderRadius: "12px",
            padding: "24px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Projects</h2>

          <div style={{ display: "grid", gap: "12px" }}>
            {projects.map((project) => (
              <div
                key={project.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr",
                  gap: "20px",
                  alignItems: "center",
                  border: "1px solid #e4e4e7",
                  borderRadius: "8px",
                  padding: "18px",
                }}
              >
                <strong>{project.name}</strong>

                <span>{project.client}</span>

                <span
                  style={{
                    background: "#f4f4f5",
                    borderRadius: "999px",
                    padding: "7px 12px",
                    width: "fit-content",
                    fontSize: "14px",
                  }}
                >
                  {project.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}