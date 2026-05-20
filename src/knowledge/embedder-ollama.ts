const EMBED_DEFAULT_MODEL = 'bge-large-zh-v1.5';

export async function embedText(text: string, baseUrl?: string): Promise<number[]> {
  const url = `${baseUrl || 'http://localhost:11434'}/api/embeddings`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_DEFAULT_MODEL, prompt: text }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        if (attempt < 2) {
          await delay(1000 * Math.pow(2, attempt));
          continue;
        }
        return [];
      }
      const data = await resp.json() as any;
      return data.embedding || [];
    } catch {
      if (attempt < 2) await delay(1000 * Math.pow(2, attempt));
      else return [];
    }
  }
  return [];
}

export async function embedBatch(texts: string[], baseUrl?: string): Promise<number[][]> {
  return Promise.all(texts.map(t => embedText(t, baseUrl)));
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
