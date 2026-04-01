# Refactor app.tsx (1,722 lines) into smaller components

## Context
`src/app.tsx` contains 10+ distinct components, utility functions, and the main App shell all in one file. This makes it hard to navigate, test, and maintain. The user wants it broken into focused files following existing project patterns.

## Approach
Extract components into `src/mission/components/` (following the existing `src/mission/orgchart/` pattern). Extract utilities into `src/mission/` modules. No barrel/index files — direct imports, named exports.

## New files to create

### Utilities (no React)
1. **`src/mission/formatters.ts`** — `cx`, `formatClockTime`, `formatDateTime`, `formatRelativeUpdate`, `formatRelativeStamp`, `taskCycleLabel`, `avatarLabel`
2. **`src/mission/tones.ts`** — `connectionTone`, `statusTone`, `taskWorkflowTone`, `connectorTone`

### Components (`src/mission/components/`)
3. **`SectionCard.tsx`** — shared section wrapper (~15 lines)
4. **`MetricCard.tsx`** — metric display card (~20 lines)
5. **`ActivityFeed.tsx`** — activity log with `activityKindIcon` helper (~50 lines)
6. **`HandoffCard.tsx`** — handoff request card (~30 lines)
7. **`AgentChatPanel.tsx`** — agent chat interface (~140 lines)
8. **`TaskDetailPanel.tsx`** — task detail/editor panel (~230 lines)
9. **`ConnectorSettingsCard.tsx`** — connector config form (~150 lines)
10. **`ProviderRosterPanel.tsx`** — provider agent roster (~95 lines)
11. **`SettingsView.tsx`** — settings page composition (~70 lines)
12. **`AgentListPanel.tsx`** — agent table (~70 lines)
13. **`AgentFormPanel.tsx`** — agent create/edit form (~200 lines)

### Remaining `app.tsx` (~450 lines)
- Imports, `NAV_ITEMS` constant, lazy OrgChart import
- Main `App` component: sidebar, nav, headers, view switching

## Other large files
These are flagged for awareness but **not** refactored in this PR:
- `ui/overlay.ts` (1,528 lines)
- `main.ts` (1,260 lines)
- `ui/characterCreator.ts` (1,067 lines)
- `scene/officeScene.ts` (992 lines)

## Execution order
1. Create `src/mission/formatters.ts` and `src/mission/tones.ts`
2. Create `src/mission/components/` directory and all 11 component files
3. Rewrite `app.tsx` to import from the new files
4. Run `npm run build` and `npm test` to verify nothing broke

## Verification
- `npm run build` passes (no type errors, no missing imports)
- `npm test` passes (existing `app.test.tsx` should work since it mocks `useMissionControl`)
- Visual spot-check that the app renders correctly
