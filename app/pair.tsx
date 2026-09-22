import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Button, H2, Input, Paragraph, Text, TextArea, XStack, YStack } from 'tamagui';
import { inviteError, inviteFromParams } from '../src/pairing/invite';
import { connection, useConnection } from '../src/relay/connection';

const canScan = Platform.OS !== 'web';

export default function Pair() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const conn = useConnection();
  const [text, setText] = useState(() => inviteFromParams(params) ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  const ready = text.trim().length > 0 && name.trim().length > 0;

  function pair(): void {
    try {
      connection.pair(text, name);
      router.replace('/');
    } catch (err) {
      setError(inviteError(err));
    }
  }

  async function startScan(): Promise<void> {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera access is needed to scan the code.');
        return;
      }
    }
    handled.current = false;
    setError(null);
    setScanning(true);
  }

  // A scan fills the invite but stops there, because every bridge gets a name from you first.
  function onScanned(data: string): void {
    if (handled.current) return;
    handled.current = true;
    setScanning(false);
    setText(data);
    setError(null);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Pair' }} />
      <YStack flex={1} p="$4" gap="$4">
        <H2>Pair a bridge</H2>
        <Paragraph color="$color11">
          Scan the QR code your bridge shows, or paste the invite link it printed, then name it.
        </Paragraph>
        {conn.pairing ? (
          <Paragraph color="$color11">
            This is added to your bridges and becomes the active one. {conn.pairing.name ?? 'Your bridge'} stays paired.
          </Paragraph>
        ) : null}

        {scanning ? (
          <YStack height={320} rounded="$4" overflow="hidden" bg="$color3">
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(result) => onScanned(result.data)}
            />
          </YStack>
        ) : null}

        <YStack gap="$2">
          <Text fontWeight="600">Name</Text>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Work"
            maxLength={40}
            autoCapitalize="words"
            autoCorrect={false}
          />
        </YStack>

        <YStack gap="$2">
          <Text fontWeight="600">Invite</Text>
          <TextArea
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError(null);
            }}
            placeholder="wizzle://pair?r=..."
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 110 }}
          />
        </YStack>
        {error ? <Paragraph color="$red10">{error}</Paragraph> : null}

        <XStack gap="$3">
          {canScan ? (
            <Button flex={1} onPress={() => (scanning ? setScanning(false) : void startScan())}>
              {scanning ? 'Stop scanning' : 'Scan QR code'}
            </Button>
          ) : null}
          <Button flex={1} theme="accent" disabled={!ready} onPress={pair}>
            Pair
          </Button>
        </XStack>
      </YStack>
    </>
  );
}
