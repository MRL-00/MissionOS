export interface ConnectionField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "url";
  placeholder?: string;
  defaultValue?: string | number;
  required?: boolean;
}

export interface EngineDefinition {
  id: string;
  label: string;
  description: string;
  connectionType: "cli" | "http" | "local";
  fields: ConnectionField[];
}

export interface EngineTestResult {
  ok: boolean;
  message: string;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  upgradeCommand?: string;
}

export interface RunParams {
  prompt: string;
  connectionConfig: Record<string, unknown>;
  agent: {
    id: string;
    name: string;
    role?: string;
    tools: string[];
  };
  context?: Record<string, unknown>;
}

export interface EngineAdapter extends EngineDefinition {
  test(config: Record<string, unknown>): Promise<EngineTestResult>;
  run(params: RunParams): AsyncGenerator<string>;
}
