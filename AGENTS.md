# Dimcan Platform Agent Instructions

These instructions are mandatory for all AI coding agents working in this repository.

## 1) Required Reading Before Any Change

1. Read all documents in /docs before making code changes.
2. Review AGENTS.md each session before editing.
3. Read relevant Next.js guidance in node_modules/next/dist/docs before framework-level changes.

## 2) Code Inspection Before Editing

1. Inspect existing code paths before editing.
2. Preserve working features unless a change request explicitly requires behavior changes.
3. Avoid duplicating logic already present in routes, utilities, or components.
4. Avoid large rewrites unless required by correctness, security, or architecture constraints.
5. Prefer small, cohesive, testable changes.
6. Follow current architecture, naming, and data-shape conventions.

## 3) UI and Interaction Standards

1. Design desktop, iPad, and iPhone behavior together.
2. Include loading, empty, error, hover, pressed, focus, and mobile interaction states.
3. Ensure touch targets are at least 44px in both dimensions for tappable controls.
4. Use progressive disclosure for advanced functionality.
5. Use whole-row interaction for primary actions when listing entities (for example file rows).
6. Use a single ellipsis menu (⋯) for secondary actions.
7. Do not place always-visible destructive buttons in primary layout areas.
8. Confirm destructive actions before execution.
9. Keep the warm, simple Dimcan visual language.
10. Prioritize contractor and client ease of use over implementation convenience.
11. Keep advanced functionality hidden until relevant or explicitly enabled.

## 4) Product Evolution Principles for Implementation

1. Build modular stages that accept future tools and integrations.
2. Never reduce long-term capability merely to simplify the current interface.
3. Favor extensible data structures over short-term shortcuts.

## 5) Security and Data Integrity

1. Validate all path segments and user inputs at API boundaries.
2. Preserve secure project-folder boundaries.
3. Use atomic writes for important JSON persistence.
4. Maintain backward compatibility with existing project data.
5. Never weaken path traversal protections or folder validation.

## 6) Completion Criteria

Before declaring work complete:

1. Test responsive behavior for desktop, iPad, and iPhone layouts.
2. Test existing workflows affected by the change.
3. Verify no regression in project storage, project.json persistence, and file operations.
4. Clearly report:
	- files changed
	- behavior added or changed
	- anything not completed or not validated

## 7) Current Technical Context Reminder

1. Runtime project storage is under K:\RenovationPlatform\Dimcan Workspace.
2. Project data persists to project.json and must remain migration-safe.
3. File operations are routed through app/api/projects/[projectName]/files/route.ts with strict folder/path validation.

