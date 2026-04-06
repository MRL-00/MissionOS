import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { getDb } from "./db.js";
import { loadServerEnv, getPort } from "./env.js";
import { startScheduleLoop } from "./scheduling.js";
import { requireAuth, registerAuthRoutes } from "./routes/auth.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerMissionRoutes } from "./routes/missions.js";
import { registerIssueRoutes } from "./routes/issues.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerScheduleRoutes } from "./routes/schedules.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerUtilityRoutes } from "./routes/utility.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const docsRoot = path.join(repoRoot, "docs");

loadServerEnv();
getDb();
getDb()
  .prepare(
    `
    UPDATE runs
    SET
      status = 'failed',
      finished_at = datetime('now'),
      output = CASE
        WHEN output IS NULL OR output = '' THEN '[error] Run interrupted by MissionOS server restart.'
        ELSE output || '\n\n[error] Run interrupted by MissionOS server restart.'
      END
    WHERE status IN ('running', 'planning')
    `,
  )
  .run();

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(requireAuth);

registerAuthRoutes(app);
registerAgentRoutes(app);
registerMissionRoutes(app);
registerIssueRoutes(app);
registerRunRoutes(app);
registerScheduleRoutes(app);
registerIntegrationRoutes(app);
registerUtilityRoutes(app, docsRoot);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Server error";
  console.error(error);
  res.status(500).json({ error: message });
});

startScheduleLoop();

app.listen(getPort(), () => {
  console.log(`MissionOS server listening on http://localhost:${getPort()}`);
});
