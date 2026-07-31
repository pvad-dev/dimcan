# Architecture

This document describes the currently implemented architecture in this repository.

## Stack and Runtime

1. Framework: Next.js 16.2.12
2. React: 19.2.4
3. Language: TypeScript
4. Linting: ESLint 9 with eslint-config-next
5. Runtime for project APIs: Node.js route handlers

Source: package.json and route exports.

## App Structure

Primary app routes:

1. / -> app/page.tsx
   - Workspace landing page
   - Lists projects
   - New project modal-style form
   - Rename, archive, delete actions via project card menus
2. /archive -> app/archive/page.tsx
   - Archived project list
   - Restore action
3. /projects/[projectName] -> app/projects/[projectName]/page.tsx
   - Decodes route param and renders ProjectPageClient
4. /projects/[projectName] client UI -> app/projects/[projectName]/ProjectPageClient.tsx
   - URL-addressable stage workspace: Overview, Files, Takeoff, Assemblies, Pricing, Activity
   - Query-string stage deep links and browser history (`?stage=<stage>`)
   - Project files, notes sheet, assemblies, understanding, pricing, and activity

Also present:

1. app/new-project/page.tsx (standalone scaffold page; not wired into current primary flow)
2. app/layout.tsx and app/globals.css (global metadata and baseline CSS variables/classes)

## API Routes

### 1) Workspace route

Path: app/api/workspace/route.ts

Responsibilities:

1. Initialize workspace folder structure.
2. List active projects.
3. List archived projects (GET with view=archive).
4. Create project folders with standard project subfolders.
5. Rename, archive, and restore projects.
6. Delete project folder permanently.
7. Append lifecycle entries into project.json activity for rename/archive/restore.

### 2) Project data route

Path: app/api/projects/[projectName]/route.ts

Responsibilities:

1. Read project.json.
2. Create default project.json if missing.
3. Normalize data to schemaVersion 2.
4. Migrate legacy notes/activity shapes.
5. Accept PATCH merges for project metadata.
6. Write data atomically using temp file + rename.

### 3) Project files route

Path: app/api/projects/[projectName]/files/route.ts

Responsibilities:

1. List files from real project folders.
2. Serve specific file content for open/preview/download.
3. Upload multipart files and classify destination folder.
4. Delete files from specific folder.
5. Rename files in-place with validation and no-overwrite behavior.
6. Move files across allowed folders with validation and no-overwrite behavior.
7. Enforce allowed folders and path boundaries.

### 4) Assembly library route

Path: app/api/assembly-library/route.ts

Responsibilities:

1. Ensure shared assembly-library.json exists under workspace root.
2. Read and normalize active and archived reusable templates.
3. Create, edit, duplicate, archive, restore, and delete templates.
4. Save project assemblies into library templates (copy or replace mode).
5. Write library updates atomically using temp file + rename.

## Storage Paths and Folder Layout

Workspace root is hard-coded in APIs:

K:\RenovationPlatform\Dimcan Workspace

Key folders:

1. Projects
2. Clients
3. Suppliers
4. Templates
5. Price Lists
6. Standards
7. AI Knowledge
8. Archive

Shared assembly library file:

K:\RenovationPlatform\Dimcan Workspace\assembly-library.json

Per-project file folders currently enforced:

1. Photos
2. Videos
3. Drawings
4. Notes
5. Documents

Archive location for projects:

K:\RenovationPlatform\Dimcan Workspace\Archive\Projects

## project.json Persistence Model

Current schema version: 2

Primary structure in app/api/projects/[projectName]/route.ts:

1. schemaVersion: number
2. displayTitle: string
3. notes: ProjectNote[]
4. activity: ActivityEntry[]
5. assemblies: ProjectAssemblyRecord[]
6. understandingOverrides: Record<string, unknown>
7. attributionData: Record<string, "AI" | "User">
8. pricingSettings: PricingSettings
9. pricingAdjustments: PricingAdjustment[]
10. pricingSummary: PricingSummary
11. updatedAt: string (ISO)

ProjectNote:

1. id
2. text
3. category
4. createdAt
5. updatedAt

ActivityEntry:

1. id
2. type
3. title
4. description
5. timestamp
6. source (system | user | ai)
7. relatedFile
8. relatedFolder
9. metadata

AssemblyLibraryData:

1. schemaVersion
2. templates: AssemblyLibraryTemplate[]
3. archivedTemplates: AssemblyLibraryTemplate[]
4. updatedAt

ProjectAssemblyRecord:

1. id
2. name
3. category
4. description
5. quantity
6. unit
7. labourItems[]
8. materialItems[]
9. equipmentItems[]
10. subcontractItems[]
11. wastePercent
12. markupPercent
13. taxHandling
14. notes
15. createdAt
16. updatedAt

AssemblyLineItem:

1. description
2. quantity
3. unit
4. unitCost
5. total
6. source
7. notes

Migration behavior implemented:

1. Legacy string notes migrate to a structured note.
2. Legacy string[] activity migrates to structured entries.
3. Activity is deduped and sorted newest-first.
4. Legacy assembly template records are normalized into the structured assembly model.
5. Pricing fields are backward-compatible: missing pricingSettings, pricingAdjustments, and pricingSummary are defaulted and normalized.

Pricing model behavior:

1. Pricing calculations are centralized in lib/project-pricing.ts.
2. Assembly line-item and markup math continues to come from lib/assembly-estimating.ts; pricing does not duplicate assembly math.
3. Pricing summary includes labour/material/equipment/subcontract subtotals, cost subtotal, assembly markup, selling subtotal, project adjustments, pre-tax subtotal, configurable PST/GST, and final total.
4. Project-level PST/GST rates and tax base selection are configurable per project.
5. Incomplete pricing state is surfaced when assemblies have missing quantity/cost/link integrity issues.

## Security and Path Validation

Implemented safeguards in route handlers include:

1. Path segment sanitization for project names, folder names, and file names.
2. Allowed-folder validation for file operations.
3. ensureWithin checks to keep operations inside intended parent directory.
4. basename usage for filenames to prevent path traversal through uploaded names.
5. Content-disposition and no-sniff headers on served files.

Important scope note:

1. There is no user authentication or authorization layer in the current code.
2. Security is currently path and input validation within a trusted environment model.

## Browser vs Server Responsibilities

### Server

1. Filesystem operations
2. Project folder lifecycle
3. Project JSON persistence
4. Validation and path safety
5. Data-shape normalization for migration-safe project.json records
6. Atomic persistence for shared assembly library file

### Browser (ProjectPageClient)

1. UI state and interaction logic
2. Local resilience cache in localStorage
3. API calls for files and project metadata
4. Optimistic UI updates and save status indicators
5. Web Share / clipboard fallback behavior
6. Automatic project-history entry creation for key user actions (file upload/delete/open/download/share/link copy, note lifecycle, manual updates, understanding changes)
7. Assemblies management UI with reusable cost model, debounced autosave, and summary calculations
8. Assembly Library page and project-level import/save bridge for reusable templates
9. Project pricing summary UI with project-level tax settings and reusable adjustment workflow persisted in project.json
10. Per-project stage preference in localStorage; the URL remains the shareable/navigation source for active stage
11. Only the active full workflow is mounted, with Overview using lightweight summaries over shared loaded project state

## Current UI Patterns in Code

Observed in app/page.tsx, app/archive/page.tsx, and ProjectPageClient.tsx:

1. Inline style-driven components (minimal extracted design system)
2. Warm neutral palette
3. Whole-row file click behavior
4. Ellipsis menus for secondary actions
5. Confirm dialogs for destructive actions
6. Save status text hints (Saving, Saved, Could not save)
7. 44px touch-target pattern applied for menu buttons and primary interactive controls in key project sections

## Known Technical Limitations

Verified from code:

1. No automated tests are present in this repository.
2. No explicit auth model for API routes.
3. Workspace path is hard-coded in route handlers.
4. UI styling is mostly inline and partially duplicated across pages.
5. app/new-project/page.tsx appears to be a standalone prototype page, separate from the primary creation flow on app/page.tsx.
6. Mobile and tablet behavior uses flexible layouts but lacks explicit breakpoint-driven design system tokens.

## Likely Extension Points

1. File lifecycle: rename/move endpoints + UI wiring + activity events.
2. Project data contracts: typed shared schema package for server/client parity.
3. Auth and permissions at API boundary.
4. Replace hard-coded workspace root with environment/config.
5. Componentization of repeated inline style UI primitives.
6. Activity search/export and richer history tooling.
7. Integrations for pricing/suppliers/execution/warranty pipelines.
8. Richer understanding engine plug-in behind current deterministic prototype.

## Uncertainty Notes

1. This document reflects code present in the current workspace only.
2. Runtime behavior not directly exercised during this documentation task is marked based on static inspection.
