import type { FileStore } from './types.ts';

export function fileUrl(ref: string): string {
  return ref;
}

// Browsers keep no files; received files show as not on this phone and nothing can be attached.
export const deviceFiles: FileStore = {
  async save() {
    return null;
  },
  async keep() {
    return null;
  },
  async read() {
    return null;
  },
  remove() {},
  forgetConversation() {},
  forgetPairing() {},
};
