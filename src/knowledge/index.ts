import fs from 'fs';
import path from 'path';
import { runStmt, queryAll } from '../db/sqlite.js';
import { embedText, embedBatch } from './embedder-ollama.js';
import type { Config } from '../config.js';

export class KnowledgeManager {
  private cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  async loadFiles() {
    const kbDir = path.join(this.cfg.data_dir, 'kb');
    if (!fs.existsSync(kbDir)) return;
    const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(kbDir, file), 'utf-8');
      const chunks = this.chunkText(content);
      for (let i = 0; i < chunks.length; i++) {
        runStmt(`
          INSERT OR IGNORE INTO knowledge_chunks (file, chunk_index, content, created_at)
          VALUES (?, ?, ?, ?)
        `, [file, i, chunks[i], Date.now()]);
      }
    }
    await this.computeEmbeddings();
  }

  private chunkText(text: string): string[] {
    const size = this.cfg.knowledge.chunk_size;
    const overlap = this.cfg.knowledge.chunk_overlap;
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + size));
      i += size - overlap;
    }
    return chunks;
  }

  private async computeEmbeddings() {
    const rows = queryAll('SELECT id, content FROM knowledge_chunks WHERE embedding IS NULL');
    if (!rows.length) return;
    console.log(`  → 计算 ${rows.length} 个文本片段的向量...`);
    const contents = rows.map((r: any) => r.content);
    const vectors = await embedBatch(contents);
    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      if (vectors[i]?.length) {
        runStmt('UPDATE knowledge_chunks SET embedding = ? WHERE id = ?', [JSON.stringify(vectors[i]), rows[i].id]);
        ok++;
      }
    }
    console.log(`  → 向量计算完成: ${ok}/${rows.length}`);
  }

  async retrieve(query: string): Promise<string[]> {
    const qVec = await embedText(query);
    if (!qVec.length) {
      const rows = queryAll('SELECT content FROM knowledge_chunks');
      return rows.map((r: any) => r.content).slice(0, this.cfg.knowledge.top_k);
    }

    const rows = queryAll('SELECT id, content, embedding FROM knowledge_chunks');
    const scored = rows
      .map((r: any) => {
        if (!r.embedding) return { ...r, score: 0 };
        try { return { ...r, score: cosineSimilarity(qVec, JSON.parse(r.embedding)) }; }
        catch { return { ...r, score: 0 }; }
      })
      .filter((r: any) => r.score >= this.cfg.knowledge.min_score)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, this.cfg.knowledge.top_k);
    return scored.map((r: any) => r.content);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}
