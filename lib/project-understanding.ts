export type ProjectUnderstanding = {
  suggestedProjectName: string;
  projectType: string;
  projectContext: string;
  confidence: number;
  detectedFiles: string[];
  possibleRooms: string[];
  detectedScope: string[];
  missingInformation: string[];
  assumptions: string[];
  detectedAssemblies: string[];
  scope: string[];
};

export type ProjectUnderstandingInput = {
  projectName: string;
  notes: string;
  files: Array<{ filename: string; type: string }>;
  assemblies: Array<{ assembly: { name: string }; sourceAssemblyId: string }>;
};

const normalizeName = (value: string) => value
  .replace(/\.[^/.]+$/, "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const firstMeaningfulLine = (notes: string) => {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => line.length > 3) ?? "";
};

export const buildSuggestedProjectName = (
  files: Array<{ filename: string; type: string }>,
  notes: string,
  manualName?: string,
) => {
  const trimmedManualName = manualName?.trim();
  if (trimmedManualName) return trimmedManualName;

  const filePart = files
    .map((file) => normalizeName(file.filename))
    .find(Boolean);

  const notePart = normalizeName(firstMeaningfulLine(notes));
  const parts = [filePart, notePart].filter(Boolean) as string[];

  if (parts.length === 0) return "Untitled Project";

  return parts.slice(0, 2).join(" - ");
};

export const recomputeProjectUnderstanding = (input: ProjectUnderstandingInput): ProjectUnderstanding => {
  const normalizedNotes = input.notes.toLowerCase();
  const files = input.files ?? [];
  const assemblies = input.assemblies ?? [];

  const scope: string[] = [];
  const assumptions: string[] = [];
  const missingInformation = ["Confirm overall scope", "Confirm site access", "Confirm material selections"];

  const detectedFiles = files.length > 0
    ? [`${files.length} file${files.length === 1 ? "" : "s"}`]
    : [];

  const possibleRooms = [] as string[];
  if (normalizedNotes.includes("bathroom")) possibleRooms.push("Bathroom");
  if (normalizedNotes.includes("kitchen")) possibleRooms.push("Kitchen");
  if (normalizedNotes.includes("shower")) possibleRooms.push("Shower");
  if (normalizedNotes.includes("patio")) possibleRooms.push("Patio");
  if (normalizedNotes.includes("washroom")) possibleRooms.push("Washroom");
  if (possibleRooms.length === 0 && files.length > 0) possibleRooms.push("Project area");

  if (assemblies.length > 0) {
    const names = assemblies.map((item) => item.assembly.name);
    scope.push(`Selected assemblies: ${names.join(", ")}`);
  }

  if (normalizedNotes.includes("client supplies tile")) {
    assumptions.push("Client supplies tile.");
    scope.push("Tile supply handled by client.");
    const tileIndex = missingInformation.indexOf("Confirm material selections");
    if (tileIndex >= 0) missingInformation.splice(tileIndex, 1);
  }

  if (normalizedNotes.includes("no demo") || normalizedNotes.includes("no demolition")) {
    assumptions.push("No demolition scope is expected.");
    const demoIndex = missingInformation.indexOf("Confirm overall scope");
    if (demoIndex >= 0) missingInformation.splice(demoIndex, 1);
  }

  if (normalizedNotes.includes("existing tub")) {
    assumptions.push("Existing tub condition should be reviewed.");
  }

  const hasTubSurround = assemblies.some((item) => item.assembly.name.toLowerCase().includes("tub surround"));
  if (hasTubSurround) {
    scope.push("Tub surround scope should be reviewed for tile, substrate, waterproofing, and trim details.");
    missingInformation.push(
      "Tile type and size",
      "Substrate/backing condition",
      "Waterproofing system",
      "Tile-supply responsibility",
      "Trim versus miter",
      "Grout type",
      "Silicone colour",
      "Plumbing penetrations",
    );
  }

  const context = [
    input.projectName.trim() || "Project",
    possibleRooms[0] ? `for ${possibleRooms[0]}` : "",
  ].filter(Boolean).join(" ");

  let confidence = 50;
  if (files.length > 0) confidence += 10;
  if (input.notes.trim()) confidence += 10;
  if (assemblies.length > 0) confidence += 10;
  if (assumptions.length > 0) confidence += 5;
  if (missingInformation.length > 0) confidence += 5;
  confidence = Math.min(95, Math.max(55, confidence));

  return {
    suggestedProjectName: buildSuggestedProjectName(files, input.notes, input.projectName),
    projectType: context || "Renovation project",
    projectContext: context || "Renovation project",
    confidence,
    detectedFiles,
    possibleRooms,
    detectedScope: scope,
    missingInformation,
    assumptions,
    detectedAssemblies: assemblies.map((item) => item.assembly.name),
    scope,
  };
};
