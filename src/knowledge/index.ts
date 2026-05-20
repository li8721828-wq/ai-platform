import fs from 'fs';
import path from 'path';
import { runStmt, queryAll } from '../db/sqlite.js';
import { embedText, embedBatch } from './embedder-ollama.js';
import type { Config } from '../config.js';
import { logger } from '../logger.js';

export class KnowledgeManager {
  private cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  async loadFiles() {
    const kbDir = path.join(this.cfg.data_dir, 'kb');
    if (!fs.existsSync(kbDir)) { fs.mkdirSync(kbDir, { recursive: true }); return; }
    const files = fs.readdirSync(kbDir).filter(f => /\.(txt|md)$/i.test(f));
    logger.info(`[Knowledge] File scan`, { dir: kbDir, fileCount: files.length });
    let added = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(kbDir, file), 'utf-8').trim();
      if (!content) continue;
      const existing = queryAll('SELECT id FROM knowledge_chunks WHERE file_name = ?', [file]);
      if (existing.length) continue;
      const chunks = chunkText(content, this.cfg.knowledge.chunk_size || 512, this.cfg.knowledge.chunk_overlap || 64);
      for (let i = 0; i < chunks.length; i++) {
        runStmt('INSERT OR IGNORE INTO knowledge_chunks (id, file_name, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?)',
          [`${file}_${i}`, file, i, chunks[i], Date.now()]);
      }
      added += chunks.length;
    }
    if (added) logger.info(`[Knowledge] New files added`, { files: files.length, chunks: added });
    this.computeEmbeddings();
  }

  private async computeEmbeddings() {
    const rows = queryAll('SELECT id, content FROM knowledge_chunks WHERE embedding IS NULL OR embedding = \'\'');
    if (!rows.length) return;
    logger.info(`[Knowledge] Computing embeddings`, { total: rows.length });
    const batchSize = 5;
    let ok = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const texts = batch.map((r: any) => r.content);
      const embeddings = await embedBatch(texts, this.cfg.knowledge.embed_base_url);
      for (let j = 0; j < batch.length; j++) {
        if (embeddings[j]?.length) {
          runStmt('UPDATE knowledge_chunks SET embedding = ? WHERE id = ?', [JSON.stringify(embeddings[j]), batch[j].id]);
          ok++;
        }
      }
    }
    logger.info(`[Knowledge] Embeddings computed`, { ok, total: rows.length });
  }

  async retrieve(query: string): Promise<string[]> {
    logger.info(`[Knowledge] Retrieving`, { query: query.slice(0, 60) });
    const qVec = await embedText(query, this.cfg.knowledge.embed_base_url);
    if (!qVec.length) {
      const rows = queryAll('SELECT content FROM knowledge_chunks');
      const result = rows.map((r: any) => r.content).slice(0, this.cfg.knowledge.top_k);
      logger.info(`[Knowledge] Retrieved (no embeddings)`, { resultCount: result.length });
      return result;
    }

    const topK = this.cfg.knowledge.top_k || 3;
    const minScore = this.cfg.knowledge.min_score || 0;
    const rows = queryAll('SELECT id, content, embedding FROM knowledge_chunks LIMIT ?', [topK * 10]);
    const scored = rows
      .map((r: any) => {
        if (!r.embedding) return { ...r, score: 0 };
        try {
          const emb = JSON.parse(r.embedding);
          return { ...r, score: cosineSimilarity(qVec, emb) };
        } catch { return { ...r, score: 0 }; }
      })
      .filter((r: any) => r.score >= minScore)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, topK);
    logger.info(`[Knowledge] Retrieved`, { resultCount: scored.length, topScore: scored[0]?.score?.toFixed(3) });
    return scored.map((r: any) => r.content);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const sentences = text.split(/(?<=[。！？.!?\n])/);
  let current = '';
  const chunks: string[] = [];
  for (const s of sentences) {
    if (current.length + s.length > size && current.length > 0) {
      if (current.trim()) chunks.push(current.trim());
      current = current.slice(-overlap);
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  if (!chunks.length) {
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + size));
      i += size - overlap;
    }
  }
  return chunks;
}
