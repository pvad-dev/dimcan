# Development Workflow

This workflow defines how the Dimcan Platform should evolve without repeatedly rebuilding context.

## 1) Input From User

1. User provides business requirements, desired behavior, and testing feedback.
2. User feedback about regressions or friction is treated as product signal, not only bug signal.

## 2) AI Agent Preparation

Before changing code, the AI agent must:

1. Read AGENTS.md.
2. Read all docs in /docs.
3. Inspect relevant code paths and existing behavior.
4. Identify constraints and preserve current working features.

## 3) Change Planning and Execution

1. Prefer cohesive, incremental changes over broad rewrites.
2. Reuse existing utilities, route contracts, and naming conventions.
3. Avoid duplicate logic.
4. Keep security boundaries intact (path validation, folder safety, input checks).
5. Keep data compatibility intact for existing project.json data.
6. Use atomic writes for important JSON persistence.

## 4) UI/UX Delivery Expectations

For every UI-affecting change:

1. Design desktop, iPad, and iPhone behavior together.
2. Include loading, empty, error, hover, pressed, focus, and mobile states.
3. Enforce minimum 44px touch targets.
4. Use progressive disclosure.
5. Keep primary list actions whole-row where appropriate.
6. Place secondary actions in ellipsis menus (⋯).
7. Confirm destructive actions and avoid persistent destructive controls in primary layouts.

## 5) Validation Before Completion

Before declaring work complete:

1. Validate changed flows and related existing flows for regressions.
2. Validate responsive behavior on desktop, iPad, and iPhone layouts.
3. Validate project file behavior, persistence behavior, and path safety for affected code.
4. Report what was not tested or not completed.

## 6) Required Documentation Updates

After meaningful changes:

1. Update docs/CURRENT_BUILD_STATUS.md with:
   - newly completed work
   - new partial work
   - new risks/issues
2. Update docs/ARCHITECTURE.md when system structure, routes, persistence, or boundaries change.
3. Update docs/UI_UX_STANDARDS.md when interaction patterns or UI standards change.
4. Update docs/PRODUCT_PRINCIPLES.md only when product direction changes.

## 7) Reporting Format for AI Agents

At the end of a task, report clearly:

1. Files changed
2. Behavior added or modified
3. Compatibility or migration considerations
4. Anything incomplete, uncertain, or unverified

## 8) Context Persistence Goal

The agent should not require the user to repeatedly explain technical context.

To achieve this:

1. Documentation must stay current after meaningful changes.
2. Architecture and status docs should be treated as active system records.
3. Agents must consult docs first, then validate against current code.
