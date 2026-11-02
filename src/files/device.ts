import { Directory, File, Paths } from 'expo-file-system';
import { MAX_FILE_BYTES } from '../protocol/index.ts';
import { fileName, safeSegment } from './paths.ts';
import type { FileStore } from './types.ts';

const ROOT = 'files';

// Stored uris are relative to Documents, since iOS can move the app's container on an update.
function at(ref: string): File {
  return new File(Paths.document, ...ref.split('/'));
}

function pairingFolder(pairingId: string): Directory {
  return new Directory(Paths.document, ROOT, safeSegment(pairingId));
}

function folder(pairingId: string, conv: string): string {
  const parts = [ROOT, safeSegment(pairingId), safeSegment(conv)];
  new Directory(Paths.document, ...parts).create({ intermediates: true, idempotent: true });
  return parts.join('/');
}

function dropFolder(dir: Directory): void {
  try {
    if (dir.exists) dir.delete();
  } catch (error) {
    console.warn('wizzle: could not remove files', error);
  }
}

// The absolute url of a stored file for this run of the app, for images and the share sheet.
export function fileUrl(ref: string): string {
  return at(ref).uri;
}

// Files live under Documents/files/<pairing>/<conversation>, named by message id.
export const deviceFiles: FileStore = {
  async save(pairingId, conv, msgId, name, bytes) {
    try {
      const ref = `${folder(pairingId, conv)}/${fileName(msgId, name)}`;
      at(ref).write(bytes);
      return ref;
    } catch (error) {
      console.warn('wizzle: could not save file', error);
      return null;
    }
  },
  async keep(pairingId, conv, id, name, sourceUri) {
    try {
      const ref = `${folder(pairingId, conv)}/${fileName(id, name)}`;
      const target = at(ref);
      if (target.exists) target.delete();
      const source = new File(sourceUri);
      // Written, not copied: a copy keeps the source's weaker protection. One past the limit is only copied, then refused.
      if ((source.size ?? 0) <= MAX_FILE_BYTES) target.write(await source.bytes());
      else source.copy(target);
      return { uri: ref, size: target.size ?? 0 };
    } catch (error) {
      console.warn('wizzle: could not copy file', error);
      return null;
    }
  },
  async read(ref) {
    try {
      const file = at(ref);
      if (!file.exists) return null;
      return await file.bytes();
    } catch (error) {
      console.warn('wizzle: could not read file', error);
      return null;
    }
  },
  remove(ref) {
    try {
      const file = at(ref);
      if (file.exists) file.delete();
    } catch (error) {
      console.warn('wizzle: could not remove file', error);
    }
  },
  forgetConversation(pairingId, conv) {
    dropFolder(new Directory(pairingFolder(pairingId), safeSegment(conv)));
  },
  forgetPairing(pairingId) {
    dropFolder(pairingFolder(pairingId));
  },
};
