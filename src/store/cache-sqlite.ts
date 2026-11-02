import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type { Agent, Conversation, Room } from '../protocol/index.ts';
import { trimMessages, type CachedConversation, type CachedMeta, type CachedPairing, type ReadMarks, type StoreCache } from './cache.ts';
import type { AgentProfile, BridgeHello, ChatEntry, OpenApproval, OpenQuestion, StoredElement } from './types.ts';

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
type Write = { pairingId: string; run: (db: SQLiteDatabase) => void };

const META_SQL = 'INSERT OR REPLACE INTO meta (pairing, key, value) VALUES (?, ?, ?)';
const CONVERSATION_SQL = 'INSERT OR REPLACE INTO conversations (pairing, conv, messages, questions, approvals) VALUES (?, ?, ?, ?, ?)';

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

// Rows are JSON blobs; a write replaces a whole row, so writes wait on a timer and the newest per row goes.
export class SqliteCache implements StoreCache {
  private readonly db: SQLiteDatabase | null;
  private readonly pending = new Map<string, Write>();
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
      let profiles: Record<string, unknown> = {};
      for (const row of this.db.getAllSync<MetaRow>('SELECT key, value FROM meta WHERE pairing = ?', pairingId)) {
        if (row.key === 'hello') meta.hello = (parseJson(row.value) as BridgeHello | null) ?? null;
        else if (row.key === 'agents') meta.agents = list<Agent>(row.value);
        else if (row.key === 'catalog') meta.catalog = list<Conversation>(row.value);
        else if (row.key === 'rooms') meta.rooms = list<Room>(row.value);
        else if (row.key === 'elements') elements = list<StoredElement>(row.value);
        else if (row.key === 'read') read = (parseJson(row.value) as ReadMarks | null) ?? null;
        else if (row.key === 'profiles') profiles = (parseJson(row.value) as Record<string, unknown> | null) ?? {};
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
      return { ...meta, conversations, elements, read, profiles };
    } catch (error) {
      console.warn('wizzle: cache load failed', error);
      return null;
    }
  }

  saveMeta(pairingId: string, meta: CachedMeta): void {
    this.queueMeta(pairingId, 'hello', meta.hello);
    this.queueMeta(pairingId, 'agents', meta.agents);
    this.queueMeta(pairingId, 'catalog', meta.catalog);
    this.queueMeta(pairingId, 'rooms', meta.rooms ?? []);
  }

  saveElements(pairingId: string, elements: StoredElement[]): void {
    this.queueMeta(pairingId, 'elements', elements);
  }

  saveRead(pairingId: string, read: ReadMarks): void {
    this.queueMeta(pairingId, 'read', read);
  }

  saveProfiles(pairingId: string, profiles: Record<string, AgentProfile>): void {
    this.queueMeta(pairingId, 'profiles', profiles);
  }

  saveConversation(pairingId: string, conv: string, data: CachedConversation): void {
    this.queue(`${pairingId}\0conv\0${conv}`, pairingId, (db) =>
      db.runSync(CONVERSATION_SQL, pairingId, conv, JSON.stringify(trimMessages(data.messages)), JSON.stringify(data.questions), JSON.stringify(data.approvals)),
    );
  }

  forgetConversation(pairingId: string, conv: string): void {
    this.pending.delete(`${pairingId}\0conv\0${conv}`);
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
    const writes = [...this.pending.values()];
    this.pending.clear();
    this.write(() => {
      this.db?.withTransactionSync(() => {
        for (const { run } of writes) if (this.db) run(this.db);
      });
    });
  }

  private queueMeta(pairingId: string, key: string, value: unknown): void {
    this.queue(`${pairingId}\0meta\0${key}`, pairingId, (db) => db.runSync(META_SQL, pairingId, key, JSON.stringify(value)));
  }

  private queue(key: string, pairingId: string, run: (db: SQLiteDatabase) => void): void {
    if (!this.db) return;
    this.pending.set(key, { pairingId, run });
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
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
