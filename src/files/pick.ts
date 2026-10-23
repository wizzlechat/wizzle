import { getDocumentAsync } from 'expo-document-picker';
import { UIImagePickerPreferredAssetRepresentationMode, launchImageLibraryAsync } from 'expo-image-picker';
import type { FileMeta } from '../protocol/index.ts';

export type Picked = FileMeta & { uri: string };

// Images only, up to what the message has room for; iOS hands over JPEG rather than HEIC.
export async function pickPhotos(limit: number): Promise<Picked[]> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return [];
  return result.assets.map((asset, i) => ({
    name: asset.fileName ?? `photo-${i + 1}.jpg`,
    mime: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize ?? 0,
    uri: asset.uri,
  }));
}

export async function pickFiles(): Promise<Picked[]> {
  const result = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    name: asset.name,
    mime: asset.mimeType ?? 'application/octet-stream',
    size: asset.size ?? 0,
    uri: asset.uri,
  }));
}
