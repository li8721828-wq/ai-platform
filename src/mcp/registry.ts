import type { MCPTool } from '../types.js';

class MCPRegistry {
  private tools = new Map<string, MCPTool>();

  register(tool: MCPTool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  async callTool(name: string, args: any): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未知工具: ${name}`);
    return tool.execute(args);
  }

  toLangChainTools() {
    return this.getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      schema: {
        type: 'object' as const,
        properties: t.parameters,
      },
    }));
  }
}

export const mcpRegistry = new MCPRegistry();
