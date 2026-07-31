# UI and UX Standards

This document defines reusable interface standards for Dimcan Platform, grounded in current patterns and intended to reduce future rewrites.

## 1) Page Hierarchy

1. Keep page structure consistent:
   - Context label
   - Primary title
   - Primary actions
   - Core content cards/sections
2. Show critical status near the primary title (for example save state).
3. Keep navigation simple and explicit (back to workspace, archive links, project entry points).

## 2) Card Standards

1. Use warm paper surfaces with clear borders.
2. Keep card headers concise and action-oriented.
3. Reserve dense controls for expanded states.
4. Use dashed cards for empty-state placeholders where appropriate.

## 3) File Row Standards

1. Entire row is the primary interaction target for open/preview.
2. Secondary actions belong in one ellipsis menu (⋯).
3. Include hover, pressed, focus-visible, and keyboard states.
4. Show metadata clearly: filename, folder badge, size/type, timestamp.
5. Keep row actions robust on touch and keyboard.

## 4) Filters

1. Filters should be visible, concise, and count-aware when possible.
2. Keep default filter broad (All) with focused category filters.
3. Empty filter result states must explain what is missing.
4. Use pill or chip patterns consistently.

## 5) Menus

1. Use contextual ellipsis menu (⋯) for secondary actions.
2. Close on outside click/tap.
3. Keep destructive action styling distinct.
4. Disable unavailable actions with explanatory labels (for example Coming later).

## 6) Modals, Previews, and File Opening

1. Primary open behavior should minimize confusion:
   - Inline-preview-capable types can open directly.
   - Non-previewable types should fall back to download behavior.
2. Provide explicit alternatives in menu:
   - Share / Open with
   - Open in browser
   - Download to Files
3. For related activity items, opening linked files should handle missing files gracefully.

## 7) Mobile and Tablet Layout

1. Design desktop, iPad, and iPhone together.
2. Use wrapping/flexible layouts for controls and metadata.
3. Do not rely only on hover interactions for critical actions.
4. Preserve readable spacing and touch-safe density.

## 8) Touch Target Requirements

1. Minimum tappable area: 44px by 44px.
2. Applies to icon-only buttons, filter chips, and primary CTA controls.
3. Increase hit area for compact controls when visual size must remain small.

## 9) Typography Hierarchy

1. Context text / eyebrow: small and muted.
2. Page title: prominent and stable.
3. Section title: medium emphasis.
4. Body and metadata: readable contrast and clear rhythm.
5. Keep visual tone warm and calm.

## 10) Loading, Empty, and Error States

1. Every async workflow must include all three states.
2. Loading copy should be direct and specific.
3. Empty states should guide next action.
4. Error states should include recovery action where possible (for example retry).

## 11) Save Indicators

1. Use subtle state text transitions:
   - Saving...
   - Saved
   - Could not save
2. Keep indicator near context where edit occurred.
3. Clear Saved state after a short delay to reduce visual noise.

## 12) Confirmation Behavior

1. Confirm destructive actions before execution:
   - Delete file
   - Delete note
   - Delete project
   - Archive/restore transitions where appropriate
2. Avoid permanent destructive controls in always-visible primary layout locations.

## 13) Accessibility and Keyboard Behavior

1. Ensure keyboard access for primary actions and menus.
2. Keep focus styling visible and consistent.
3. Support Enter/Space interactions for role=button elements.
4. Preserve semantic controls where available (button, input, select, textarea).
5. Do not depend on color alone for destructive semantics.

## 14) Interaction Rules

1. Primary actions should be obvious and reversible when possible.
2. Secondary actions should be contextual and grouped.
3. Use progressive disclosure for complex or infrequent workflows.
4. Keep advanced options hidden until they are relevant or enabled.

## 15) Standards to Reduce Future Rewrites

1. Reuse interaction conventions (rows, menus, filters, status chips).
2. Keep data models structured and extensible.
3. Prefer additive enhancements over disruptive redesigns.
4. Align server contracts and client state shapes before introducing new modules.
5. Introduce shared UI primitives when repetition grows, while preserving current behavior.

## 16) Assemblies Estimating UX

1. Show assembly cards with concise estimate signals first: category, quantity, labour/material subtotals, markup, and total.
2. Keep secondary assembly actions in one ellipsis menu (edit, duplicate, delete).
3. Use modal or panel editing for dense line-item workflows; keep touch-safe controls (minimum 44px).
4. Include explicit empty, validation, save-state, and error messaging in assemblies workflows.
5. Avoid activity noise: create one structured activity entry per create/duplicate/delete and one meaningful edit entry per edit session.
6. Clearly label estimating assumptions (for example waste application and current tax handling approach).

## Current-Code Notes

1. Current implementation uses mostly inline styles, with some global CSS tokens.
2. These standards should guide incremental consolidation into reusable components without changing user-visible behavior unexpectedly.
