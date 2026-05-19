export async function embedText(text: string): Promise<number[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-large-zh-v1.5', prompt: text }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await resp.json() as any;
    return data.embedding || [];
  } catch {
    return [];
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(embedText));
}
