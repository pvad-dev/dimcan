# Current Build Status

Status is based on repository code inspection at the time of writing.

## Completed Features (Verified in Code)

1. Workspace initialization and listing:
   - Creates standard workspace folders.
   - Lists active projects.
2. Project lifecycle actions:
   - Create project
   - Rename project (folder + display title)
   - Archive project
   - Restore archived project
   - Delete project
3. Project file API using real project folders:
   - List files
   - Upload files (multipart)
   - Delete files
   - Serve files with inline vs attachment behavior
4. File classification into project folders:
   - Photos, Videos, Drawings, Notes, Documents
5. Path and input validation in file and project APIs:
   - Sanitization and parent-boundary checks
6. Project metadata persistence in project.json:
   - GET/PATCH route
   - Schema versioning
   - Atomic writes
7. Migration support for legacy notes/activity shapes into schema v2 structures.
8. Project page workflows:
   - Files card with drag and drop onto whole card
   - File filters
   - Whole-row file open interaction
   - Ellipsis file menu
   - Share/Open With flow with clipboard fallback
   - File rename action with validation and extension-preserving behavior
   - File move-to-folder action with destination validation
   - Automatic activity entries for file open/download/share/link-copy actions
9. Notes and activity workflows:
   - Multi-note system with categories
   - Structured activity history with filters and day grouping
   - Manual activity entry creation
   - Activity item deletion with confirmation
   - Automatic activity entry when understanding overrides are reset to AI baseline
   - Automatic structured entries for file rename and file move
10. Assemblies workflow:
   - Create, edit, duplicate, and delete reusable assemblies
   - Structured assembly model in project.json with labour, material, equipment, and subcontract line items
   - Debounced autosave for assembly edits with shared project save-state indicator
   - Centralized subtotal, waste, markup, and pre-tax total calculations
   - Backward-compatible normalization of legacy assembly records
   - Add from Library (multi-select import) in project Assemblies
   - Save project assembly to Library with copy-or-replace conflict flow
11. Assembly Library workflow:
   - Shared reusable template storage in assembly-library.json at workspace root
   - Create/edit/duplicate/archive/restore/delete templates
   - Search and category filtering
   - Accessible from Workspace and Project Assemblies
12. Save state indicators:
   - Saving, Saved, Could not save
13. Project pricing workflow:
   - Project-level pricing settings persisted in project.json (PST/GST enable, rates, tax base, percent-adjustment base)
   - Project-level pricing adjustments (allowance, discount, contingency, overhead, custom) with add/edit/duplicate/enable-disable/delete
   - Centralized pricing summary utility that combines assemblies, takeoff-linked assembly quantities, adjustments, and configurable taxes
   - Pricing summary section on project page with compact totals and expandable detailed breakdown
   - Incomplete pricing visibility when assemblies are missing quantity/cost or have broken takeoff links
   - Structured activity entries for meaningful pricing setting changes and adjustment lifecycle actions
13. Archive and restore activity logging from workspace API.
14. Project rename hardening:
   - Workspace rename validates trimmed names and rejects invalid Windows characters, reserved names, trailing spaces/periods, empty names, and duplicate folders.
   - Path-boundary checks are enforced when constructing project folder paths.
   - Exact same-name rename returns success without calling filesystem rename.
   - Case-only renames on Windows use a temporary intermediate folder rename to avoid EPERM.
   - project.json is updated after rename to set displayTitle and align assembly projectId references with the new folder name.
   - Project page title rename now performs workspace rename and navigates to /projects/<newName> on success.

## Partially Completed Features

1. Responsive behavior:
   - Many controls use flexible wrapping and touch-sized buttons.
   - Project page spacing and title typography use responsive scaling.
   - No comprehensive breakpoint-based layout system is implemented.
2. Design system consistency:
   - Some global CSS tokens exist.
   - Most pages still rely on inline styles and repeated style blocks.
3. AI understanding subsystem:
   - Deterministic prototype is implemented.
   - Not integrated with external AI services in this codebase.

## Known Issues and Risks

1. No auth/permission model on API routes.
2. Workspace root path is hard-coded to a Windows path.
3. No automated test suite present for API or UI flows.
4. File operations rely on local filesystem availability and permissions.
5. Duplicate style logic across pages increases long-term maintenance cost.
6. app/new-project/page.tsx appears disconnected from current primary creation flow.
7. Assembly-level taxHandling remains informational at assembly level; project-level tax treatment now uses configurable project pricing settings.

## Untested or Not Verified During This Documentation Task

1. End-to-end runtime behavior for all mobile browsers/devices.
2. Stress scenarios for large file uploads and high activity volume.
3. Concurrent edit/write race behavior across multiple clients.
4. Performance on very large project folders and large activity histories.
5. Cross-network behavior outside local/trusted environment assumptions.

## Current Project Files and Data Behavior

1. Project files are stored directly in each project folder under category subfolders.
2. File listing is aggregated across allowed folders and sorted by latest modified date.
3. Upload collisions are handled by auto-incremented filenames.
4. File serving supports content type and inline/attachment disposition logic.
5. project.json is created automatically if missing.
6. project.json writes use temp file + rename atomic strategy.
7. Local browser storage is used as resilience/fallback and migration source, with server persistence as primary.

## Recommended Next Features (Logical Order)

1. Introduce auth and project-level access control for API routes.
2. Move hard-coded workspace path to environment/config with safe defaults.
3. Add automated tests:
   - API route tests for validation and persistence
   - UI interaction smoke tests for files/notes/activity
4. Consolidate repeated inline styles into reusable components/tokens without changing behavior.
5. Add pagination/virtualization strategy for large activity and file lists.
6. Define integration contract layer for future supplier/estimating/execution/warranty modules.
7. Add automated UI tests for activity event coverage (open/share/download/rename/move/reset actions).
8. Add quotation output/export layer using pricingSummary as source of truth.

## Confidence and Uncertainty

1. Feature status above is verified by static code inspection.
2. Items marked untested were not runtime-validated in this documentation task.
