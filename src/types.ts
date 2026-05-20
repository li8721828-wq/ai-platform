export interface UnifiedMessage {
  id: string;
  platform: 'qq' | 'web';
  channel: 'private' | 'group';
  from: { userId: string; userName?: string; groupId?: string; groupName?: string };
  text: string;
  segments: MessageSegment[];
  timestamp: number;
  raw?: any;
}

export type MessageSegment =
  | { type: 'text'; data: { text: string } }
  | { type: 'image'; data: { file: string; url: string } }
  | { type: 'at'; data: { qq: string } }
  | { type: 'reply'; data: { id: string } };

export interface Persona {
  name: string;
  avatar?: string;
  gender?: string;
  age?: number;
  personality: string[];
  speakingStyle?: string;
  background?: string;
  likes?: string[];
  dislikes?: string[];
  greeting?: string;
  customFields?: Record<string, any>;
}

export interface MemoryConfig {
  shortTerm: number;
  longTerm: 'summary' | 'off';
  factMemory: boolean;
}

export interface RouteDef {
  type: 'catchall' | 'command' | 'keyword' | 'llm_match';
  commands?: string[];
  keywords?: string[];
  prompt?: string;
  priority?: number;
}

export interface AgentDef {
  id: string;
  name?: string;
  enabled?: boolean;
  provider?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  persona?: Persona;
  memory?: MemoryConfig;
  greeting?: string;
  tools: string[];
  mcpServers: string[];
  route: RouteDef;
}

export interface ModelProvider {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  models: string;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: any) => Promise<string>;
}

export interface TraceSpan {
  traceId: string;
  parentId?: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error';
  metadata: Record<string, any>;
  error?: string;
}

export interface SkillResult {
  type: 'text' | 'image' | 'audio';
  content: string;
}
