import fs from 'fs';
import path from 'path';

export interface SkillModule {
  name: string;
  description: string;
  version: string;
  match: (text: string) => boolean;
  execute: (text: string, context: any) => string | Promise<string>;
}

class SkillRegistry {
  private skills = new Map<string, SkillModule>();

  async loadFromDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.tryLoad(dir, entry.name);
      }
    }
  }

  private async tryLoad(dir: string, name: string) {
    const candidates = [
      path.resolve(dir, name),
      path.resolve(dir, name, 'index.js'),
      path.resolve(dir, name, 'index.mjs'),
    ];
    for (const loc of candidates) {
      try {
        const fileUrl = loc.startsWith('file://') ? loc : `file:///${loc.replace(/\\/g, '/')}`;
        const mod = await import(fileUrl) as any;
        if (typeof mod.execute !== 'function') continue;
        const skill: SkillModule = {
          name: mod.name || name,
          description: mod.description || '',
          version: mod.version || '1.0',
          match: mod.match || (() => false),
          execute: mod.execute,
        };
        this.skills.set(name, skill);
        console.log(`[Skill] 加载: ${skill.name} (${name})`);
        return;
      } catch { continue; }
    }
    console.error(`[Skill] 加载失败: ${name}，请确保插件目录包含 index.js`);
  }

  getSkill(name: string): SkillModule | undefined {
    return this.skills.get(name);
  }

  match(text: string): SkillModule[] {
    return Array.from(this.skills.values()).filter(s => s.match(text));
  }

  async execute(text: string, context: any = {}): Promise<string | null> {
    const matched = this.match(text);
    for (const skill of matched) {
      try {
        const result = await skill.execute(text, context);
        if (result) return result;
      } catch (err) {
        console.error(`[Skill] 执行失败: ${skill.name}`, err);
      }
    }
    return null;
  }
}

export const skillRegistry = new SkillRegistry();
