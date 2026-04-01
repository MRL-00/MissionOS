# Tasks UI Cleanup Plan

## Changes

### 1. Task List Cards (left panel)
- Transform flat `mission-issue-row` buttons into proper elevated cards with borders, background, and spacing
- Better visual hierarchy: identifier + team as a header row, title prominent, status/assignee/cycle as footer chips
- Add a subtle left-side color accent based on workflow state

### 2. Markdown Image Rendering (descriptions & comments)
- Create a lightweight `MarkdownContent` component (no external deps) that:
  - Renders `![alt](url)` as `<img>` tags with proper styling (rounded, max-width, clickable)
  - Renders `**bold**` as `<strong>`
  - Renders `### headings` as styled headings
  - Renders `[text](url)` as clickable links
  - Preserves plain text with whitespace-pre-wrap
- Replace raw `{task.description}` and `{comment.body}` with `<MarkdownContent text={...} />`
- Also apply to handoff notes

### Files Modified
- `src/app.tsx` — new `MarkdownContent` component, updated task list rendering, updated detail panel
- `src/app.css` — updated card styles, image styles
