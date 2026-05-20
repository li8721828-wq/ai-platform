import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { logger } from '../logger.js';
import { eventBus } from '../event-bus.js';

export interface SkillContext {
  userId: string;
  agentId?: string;
  logger: typeof logger;
  [key: string]: any;
}

export interface SkillModule {
  name: string;
  description: string;
  version: string;
  match: (text: string) => boolean;
  execute: (text: string, context: SkillContext) => string | Promise<string>;
  onLoad?: (ctx: SkillContext) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
}

interface LoadedSkill {
  module: SkillModule;
  dir: string;
  loadedAt: number;
}

export class SkillRegistry {
  private skills = new Map<string, LoadedSkill>();

  async loadFromDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.tryLoad(dir, entry.name);
      }
    }
    logger.info('[SkillRegistry] 技能加载完成', { count: this.skills.size, dir });
  }

  private async tryLoad(dir: string, name: string) {
    const pluginDir = path.resolve(dir, name);
    const indexFile = [path.join(pluginDir, 'index.mjs'), path.join(pluginDir, 'index.js')]
      .find(f => fs.existsSync(f));
    if (!indexFile) {
      logger.warn('[SkillRegistry] 技能加载失败，缺少入口文件', { name });
      return;
    }

    try {
      let mod: any;

      // Try ESM import first
      if (indexFile.endsWith('.mjs') || !indexFile.endsWith('.cjs')) {
        try {
          const fileUrl = `file:///${indexFile.replace(/\\/g, '/')}?t=${Date.now()}`;
          mod = await import(fileUrl);
        } catch {
          mod = null;
        }
      }

      // Fallback to VM sandbox (CommonJS)
      if (!mod) {
        try {
          const code = fs.readFileSync(indexFile, 'utf-8');
          const sandbox: any = {
            console: { log: (...args: any[]) => logger.info(`[Skill:${name}]`, ...args), error: (...args: any[]) => logger.error(`[Skill:${name}]`, ...args) },
            setTimeout, clearTimeout, fetch, JSON, Math, Date, RegExp, Error, parseInt, parseFloat, String, Number, Boolean, Array, Object,
            module: { exports: {} }, exports: {}, require: (id: string) => {
              if (id === 'skill-context') return {};
              throw new Error(`不允许的 require: ${id}`);
            },
          };
          vm.createContext(sandbox);
          vm.runInContext(code, sandbox, { filename: indexFile });
          mod = sandbox.module.exports || sandbox.exports;
        } catch (vmErr) {
          logger.error('[SkillRegistry] 技能 VM 加载也失败', { name, error: (vmErr as Error).message });
          return;
        }
      }

      if (typeof mod.execute !== 'function') {
        logger.warn('[SkillRegistry] 技能缺少 execute 函数', { name });
        return;
      }

      const skill: SkillModule = {
        name: mod.name || name,
        description: mod.description || '',
        version: mod.version || '1.0',
        match: mod.match || (() => false),
        execute: mod.execute,
        onLoad: mod.onLoad,
        onUnload: mod.onUnload,
      };

      // Call onLoad lifecycle
      if (skill.onLoad) {
        await skill.onLoad({ userId: '', logger: logger.child(`Skill:${name}`) });
      }

      this.skills.set(name, {
        module: skill,
        dir: pluginDir,
        loadedAt: Date.now(),
      });

      logger.info('[SkillRegistry] 技能已加载', { name: skill.name, version: skill.version });
    } catch (err) {
      logger.error('[SkillRegistry] 技能加载失败', { name, error: (err as Error).message });
    }
  }

  async unload(name: string) {
    const skill = this.skills.get(name);
    if (!skill) return;
    try {
      await skill.module.onUnload?.();
    } catch (err) {
      logger.warn('[SkillRegistry] 技能 onUnload 失败', { name, error: (err as Error).message });
    }
    this.skills.delete(name);
    logger.info('[SkillRegistry] 技能已卸载', { name });
  }

  async reload(name: string, dir: string) {
    await this.unload(name);
    await this.tryLoad(dir, name);
  }

  getSkill(name: string): SkillModule | undefined {
    return this.skills.get(name)?.module;
  }

  listSkills(): SkillModule[] {
    return Array.from(this.skills.values()).map(s => s.module);
  }

  match(text: string): SkillModule[] {
    return this.listSkills().filter(s => s.match(text));
  }

  async execute(text: string, context: SkillContext): Promise<string | null> {
    const matched = this.match(text);
    for (const skill of matched) {
      try {
        const result = await skill.execute(text, context);
        if (result) {
          eventBus.emit('skill:executed', { name: skill.name, text: text.slice(0, 100), result: result.slice(0, 100) });
          return result;
        }
      } catch (err) {
        logger.error('[SkillRegistry] 技能执行失败', { name: skill.name, error: (err as Error).message });
      }
    }
    return null;
  }
}

export const skillRegistry = new SkillRegistry();
