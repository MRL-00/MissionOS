import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { getDb } from "./db.js";
import { loadServerEnv, getCorsOrigin, getPort } from "./env.js";
import { formatHttpError } from "./httpErrors.js";
import { applySecurityHeaders } from "./securityHeaders.js";
import { startScheduleLoop } from "./scheduling.js";
import { sendClientIndex, setStaticAssetHeaders } from "./staticAssets.js";
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
const clientDistRoot = path.join(repoRoot, "dist");
const clientIndexPath = path.join(clientDistRoot, "index.html");

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

app.use(applySecurityHeaders);
app.use(cors({ origin: getCorsOrigin() }));
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

if (existsSync(clientIndexPath)) {
  app.use(express.static(clientDistRoot, { setHeaders: setStaticAssetHeaders }));
  app.get(/^(?!\/api(?:\/|$)).*/u, (_req, res) => {
    sendClientIndex(res, clientIndexPath);
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const response = formatHttpError(error, process.env.NODE_ENV);
  if (response.status >= 500) {
    console.error(error);
  }
  res.status(response.status).json(response.body);
});

startScheduleLoop();

app.listen(getPort(), () => {
  console.log(`MissionOS server listening on http://localhost:${getPort()}`);
});
