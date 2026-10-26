import type { CachedConversation, CachedMeta, CachedPairing, ReadMarks, StoreCache } from './cache.ts';
import type { StoredElement } from './types.ts';

// Browsers get no cache; the bridge resends everything on sync during development.
export class SqliteCache implements StoreCache {
  load(_pairingId: string): CachedPairing | null {
    return null;
  }
  saveMeta(_pairingId: string, _meta: CachedMeta): void {}
  saveConversation(_pairingId: string, _conv: string, _data: CachedConversation): void {}
  saveElements(_pairingId: string, _elements: StoredElement[]): void {}
  saveRead(_pairingId: string, _read: ReadMarks): void {}
  forgetConversation(_pairingId: string, _conv: string): void {}
  forgetPairing(_pairingId: string): void {}
  flush(): void {}
}
