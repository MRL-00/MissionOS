# MissionOS

Multi-agent orchestration platform. React + Vite frontend, Express + SQLite backend.

## Key Directories

- `src/` — React frontend
- `server/src/` — Express backend
- `docs/` — Documentation
- `public/assets/` — Static assets

## Common File Locations

- Login: `src/pages/setup/LoginPage.tsx`
- Sidebar: `src/layout/Sidebar.tsx`
- Settings: `src/pages/settings/Settings.tsx`
- App routing: `src/app.tsx`
- UI components: `src/components/ui/`

## Tech Stack

React 19, Vite, TypeScript, Tailwind CSS v4, Express 5, better-sqlite3, pnpm

## Commands

- `pnpm typecheck` — Type checking
- `pnpm test:client` — Client tests
- `pnpm build` — Production build

## Package Manager

Always use `pnpm`. Never `npm` or `yarn`.

## UI Conventions

Dark theme with oklch colors. Background `#0f0f10`, cards `#131314`, muted text `#918f90`, purple gradients for primary actions. Icons from `lucide-react`. Components from `shadcn/ui` in `src/components/ui/`.

## Rules

- Do NOT spawn sub-agents (the Agent tool) for simple file searches. Use Glob and Grep directly. Only use sub-agents for genuinely complex multi-step research tasks.
- Do NOT attempt to run `pnpm install` or fix missing node_modules in worktree environments. If dependencies are not available, skip verification and report that verification was skipped due to worktree dependency limitations.
- Keep changes minimal and tightly scoped. Do not refactor surrounding code, add comments to unchanged code, or improve error handling beyond what was requested.
