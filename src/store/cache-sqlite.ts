import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { Agent, Conversation } from '../protocol/index.ts';
import { trimMessages, type CachedConversation, type CachedMeta, type CachedPairing, type ReadMarks, type StoreCache } from './cache.ts';
import type { BridgeHello, ChatEntry, OpenApproval, OpenQuestion, StoredElement } from './types.ts';

const DB_NAME = 'wizzle-cache.db';
const WRITE_DELAY_MS = 300;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (pairing TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (pairing, key));
CREATE TABLE IF NOT EXISTS conversations (
  pairing TEXT NOT NULL, conv TEXT NOT NULL,
  messages TEXT NOT NULL, questions TEXT NOT NULL, approvals TEXT NOT NULL,
  PRIMARY KEY (pairing, conv)
);`;

type MetaRow = { key: string; value: string };
type ConversationRow = { conv: string; messages: string; questions: string; approvals: string };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function list<T>(text: string): T[] {
  const value = parseJson(text);
  return Array.isArray(value) ? (value as T[]) : [];
}

// Rows are JSON blobs per conversation; a write replaces the whole row, so writes are batched on a timer.
export class SqliteCache implements StoreCache {
  private readonly db: SQLiteDatabase | null;
  private readonly pending = new Map<string, { pairingId: string; conv: string; data: CachedConversation }>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    let db: SQLiteDatabase | null = null;
    try {
      db = openDatabaseSync(DB_NAME);
      db.execSync('PRAGMA journal_mode = WAL;');
      db.execSync(SCHEMA);
    } catch (error) {
      console.warn('wizzle: cache unavailable', error);
      db = null;
    }
    this.db = db;
  }

  load(pairingId: string): CachedPairing | null {
    if (!this.db) return null;
    try {
      const meta: CachedMeta = { hello: null, agents: [], catalog: [] };
      let elements: StoredElement[] = [];
      let read: ReadMarks | null = null;
      for (const row of this.db.getAllSync<MetaRow>('SELECT key, value FROM meta WHERE pairing = ?', pairingId)) {
        if (row.key === 'hello') meta.hello = (parseJson(row.value) as BridgeHello | null) ?? null;
        else if (row.key === 'agents') meta.agents = list<Agent>(row.value);
        else if (row.key === 'catalog') meta.catalog = list<Conversation>(row.value);
        else if (row.key === 'elements') elements = list<StoredElement>(row.value);
        else if (row.key === 'read') read = (parseJson(row.value) as ReadMarks | null) ?? null;
      }
      const conversations = new Map<string, CachedConversation>();
      const rows = this.db.getAllSync<ConversationRow>('SELECT conv, messages, questions, approvals FROM conversations WHERE pairing = ?', pairingId);
      for (const row of rows) {
        conversations.set(row.conv, {
          messages: trimMessages(list<ChatEntry>(row.messages)),
          questions: list<OpenQuestion>(row.questions),
          approvals: list<OpenApproval>(row.approvals),
        });
      }
      return { ...meta, conversations, elements, read };
    } catch (error) {
      console.warn('wizzle: cache load failed', error);
      return null;
    }
  }

  saveMeta(pairingId: string, meta: CachedMeta): void {
    this.write(() => {
      const entries: [string, unknown][] = [
        ['hello', meta.hello],
        ['agents', meta.agents],
        ['catalog', meta.catalog],
      ];
      for (const [key, value] of entries) {
        this.db?.runSync('INSERT OR REPLACE INTO meta (pairing, key, value) VALUES (?, ?, ?)', pairingId, key, JSON.stringify(value));
      }
    });
  }

  saveElements(pairingId: string, elements: StoredElement[]): void {
    this.write(() => {
      this.db?.runSync('INSERT OR REPLACE INTO meta (pairing, key, value) VALUES (?, ?, ?)', pairingId, 'elements', JSON.stringify(elements));
    });
  }

  saveRead(pairingId: string, read: ReadMarks): void {
    this.write(() => {
      this.db?.runSync('INSERT OR REPLACE INTO meta (pairing, key, value) VALUES (?, ?, ?)', pairingId, 'read', JSON.stringify(read));
    });
  }

  saveConversation(pairingId: string, conv: string, data: CachedConversation): void {
    if (!this.db) return;
    this.pending.set(`${pairingId}\0${conv}`, { pairingId, conv, data });
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
  }

  forgetConversation(pairingId: string, conv: string): void {
    this.pending.delete(`${pairingId}\0${conv}`);
    this.write(() => this.db?.runSync('DELETE FROM conversations WHERE pairing = ? AND conv = ?', pairingId, conv));
  }

  forgetPairing(pairingId: string): void {
    for (const [key, row] of [...this.pending]) if (row.pairingId === pairingId) this.pending.delete(key);
    this.write(() => {
      this.db?.runSync('DELETE FROM conversations WHERE pairing = ?', pairingId);
      this.db?.runSync('DELETE FROM meta WHERE pairing = ?', pairingId);
    });
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const rows = [...this.pending.values()];
    this.pending.clear();
    this.write(() => {
      this.db?.withTransactionSync(() => {
        for (const { pairingId, conv, data } of rows) {
          this.db?.runSync(
            'INSERT OR REPLACE INTO conversations (pairing, conv, messages, questions, approvals) VALUES (?, ?, ?, ?, ?)',
            pairingId,
            conv,
            JSON.stringify(trimMessages(data.messages)),
            JSON.stringify(data.questions),
            JSON.stringify(data.approvals),
          );
        }
      });
    });
  }

  // A cache write that fails loses nothing the bridge cannot send again, so it only logs.
  private write(run: () => void): void {
    if (!this.db) return;
    try {
      run();
    } catch (error) {
      console.warn('wizzle: cache write failed', error);
    }
  }
}
