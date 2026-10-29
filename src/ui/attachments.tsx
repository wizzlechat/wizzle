import { shareAsync } from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Image, Pressable } from 'react-native';
import { Text, YStack } from 'tamagui';
import { fileUrl } from '../files/device';
import { isImage } from '../files/paths.ts';
import type { ReceivedFile } from '../store/types.ts';
import { fileSize } from './time.ts';

const MAX_IMAGE_WIDTH = 260;
const PLACEHOLDER_HEIGHT = 160;

function share(uri: string, mime: string): void {
  shareAsync(uri, { mimeType: mime }).catch((error) => console.warn('wizzle: share failed', error));
}

// A received or sent file: an image inline, anything else as a tile; a tap hands it to the share sheet.
export function FileView({ file }: { file: ReceivedFile }) {
  const uri = file.uri ? fileUrl(file.uri) : undefined;
  if (!uri) return <Tile name={file.name} detail={`${file.mime}, ${fileSize(file.size)}. Not in wizzle.`} />;
  return (
    <Pressable onPress={() => share(uri, file.mime)}>
      {isImage(file.mime) ? <Picture uri={uri} /> : <Tile name={file.name} detail={`${file.mime}, ${fileSize(file.size)}`} />}
    </Pressable>
  );
}

function Tile({ name, detail }: { name: string; detail: string }) {
  return (
    <YStack gap="$1" p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor" self="flex-start" maxW="100%">
      <Text fontWeight="600">{name}</Text>
      <Text fontSize="$1" color="$color11">
        {detail}
      </Text>
    </YStack>
  );
}

// The image's own aspect ratio sets the height once its size is known.
function Picture({ uri }: { uri: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (live && width > 0 && height > 0) setRatio(height / width);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [uri]);
  const height = ratio === null ? PLACEHOLDER_HEIGHT : Math.round(MAX_IMAGE_WIDTH * ratio);
  return (
    <Image
      source={{ uri }}
      resizeMode="cover"
      style={{ width: MAX_IMAGE_WIDTH, maxWidth: '100%', height, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.15)' }}
    />
  );
}
