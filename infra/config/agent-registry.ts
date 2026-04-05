import { WORKSPACE_PATH } from "./constants";

export interface AgentDefinition {
  id: string;
  default?: boolean;
  workspacePath: string;
}

export const agents = [
  {
    id: "main",
    default: true,
    workspacePath: WORKSPACE_PATH,
  },
] as const satisfies readonly AgentDefinition[];

const agentsList: AgentDefinition[] = [...agents];

export function allAgents(): AgentDefinition[] {
  return agentsList;
}
