import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type PrivacyModule = {
  protectFolders(names: string[]): Promise<void>;
  onDeviceSpeechLocale(lang: string): string | null;
  speak(text: string): Promise<void>;
  stopSpeaking(): Promise<void>;
};

// The app's own module in modules/wizzle-privacy; iOS only, so elsewhere it is null.
const native = requireOptionalNativeModule<PrivacyModule>('WizzlePrivacy');
if (!native && Platform.OS === 'ios') console.error('wizzle: the WizzlePrivacy module is missing, rebuild the app');

// The SQLite cache and the saved files, both under Documents.
const FOLDERS = ['SQLite', 'files'];
let started = false;

export function protectStorage(): void {
  if (started || !native) return;
  started = true;
  native.protectFolders(FOLDERS).catch((error: unknown) => console.error('wizzle: could not protect stored data', error));
}

// The locale to dictate in when the phone recognizes it itself; null when audio would leave the device.
export function onDeviceSpeechLocale(lang: string): string | null {
  return native?.onDeviceSpeechLocale(lang) ?? null;
}

// False off iOS, and on a build from before the module could speak.
export const canReadAloud = typeof native?.speak === 'function';

// Resolves when the text has been read, is stopped, or the next text starts.
export function readAloud(text: string): Promise<void> {
  return native ? native.speak(text) : Promise.resolve();
}

export function stopReadingAloud(): Promise<void> {
  return native ? native.stopSpeaking() : Promise.resolve();
}
