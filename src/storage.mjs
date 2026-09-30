import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const hash = text => createHash('sha256').update(text).digest('hex');
export async function read(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export async function atomic(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, file); }
  finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
// Provider transport receipts only: no transcripts, native history or run-status mirror.
export class Receipts {
  constructor(directory) { this.file = join(directory, 'receipts.json'); this.serial = Promise.resolve(); }
  async load() {
    const rows = await read(this.file, []);
    if (!Array.isArray(rows)) throw Error('Invalid receipt state');
    return rows;
  }
  async change(key, update) {
    const work = this.serial.then(async () => {
      const rows = await this.load();
      let row = rows.find(r => r.key === key);
      if (!row) {
        if (rows.length >= 1000) {
          const index = rows.findIndex(r => r.closed && !r.uncertain);
          if (index < 0) throw Error('Receipt capacity reached');
          rows.splice(index, 1);
        }
        row = { key, createdAt: new Date().toISOString(), sends: [] }; rows.push(row);
      }
      await update(row);
      await atomic(this.file, rows);
      return structuredClone(row);
    });
    this.serial = work.catch(() => {});
    return work;
  }
}
