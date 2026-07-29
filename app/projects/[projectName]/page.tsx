import ProjectPageClient from "./ProjectPageClient";

export default async function ProjectPage({ params }: { params: any }) {
  const { projectName } = await params;
  const decodedProjectName = decodeURIComponent(projectName);

  return <ProjectPageClient projectName={decodedProjectName} />;
}
