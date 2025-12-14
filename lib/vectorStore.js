import fs from 'fs';
import path from 'path';

const STORE_PATH = process.env.VECTOR_STORE_PATH || path.join(process.cwd(), 'vectorStore.json');

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function writeStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

export function addEntry({ id, summary, embedding, ts = Date.now(), meta = {} }) {
  const store = readStore();
  store.push({ id, summary, embedding, ts, meta });
  writeStore(store);
}

export function allEntries() {
  return readStore();
}

export function cosine(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export function findSimilar(embedding, topK = 3) {
  const store = readStore();
  if (!store.length) return [];
  const scored = store.map(entry => ({ entry, score: cosine(embedding, entry.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => ({ id: s.entry.id, summary: s.entry.summary, score: s.score, ts: s.entry.ts }));
}
