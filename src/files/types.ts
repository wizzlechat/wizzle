// Where received and picked files live in wizzle. The tests supply their own.
export interface FileStore {
  // Writes bytes for a message and answers the saved uri (the store's own reference), or null.
  save(pairingId: string, conv: string, msgId: string, name: string, bytes: Uint8Array): Promise<string | null>;
  // Copies a picked file into the folder for its conversation under the given id, and measures it.
  keep(pairingId: string, conv: string, id: string, name: string, sourceUri: string): Promise<{ uri: string; size: number } | null>;
  read(uri: string): Promise<Uint8Array | null>;
  remove(uri: string): void;
  forgetConversation(pairingId: string, conv: string): void;
  forgetPairing(pairingId: string): void;
}
