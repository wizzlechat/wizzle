import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { connection } from '../relay/connection.ts';
import { pairingIdFromNotification } from './notification.ts';

const ios = Platform.OS === 'ios';
const ASK = { ios: { allowAlert: true, allowBadge: true, allowSound: true } };

export type NotificationStatus = 'granted' | 'denied' | 'undetermined';

// The relay's alert is a wake for wizzle while it is away; in the foreground the socket already carries the news.
if (ios) {
  Notifications.setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

function tokenOf(token: Notifications.DevicePushToken): string | null {
  return token.type === 'ios' && typeof token.data === 'string' ? token.data : null;
}

async function register(): Promise<void> {
  try {
    const token = tokenOf(await Notifications.getDevicePushTokenAsync());
    if (token) connection.setPushToken(token);
  } catch (err) {
    console.warn('wizzle: push token unavailable', err);
  }
}

async function ask(): Promise<void> {
  const status = await Notifications.requestPermissionsAsync(ASK);
  if (status.granted) await register();
}

function statusOf(permissions: Notifications.NotificationPermissionsStatus): NotificationStatus {
  if (permissions.granted) return 'granted';
  return permissions.status === Notifications.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}

// What iOS allows right now, read again each time the app comes back to the front. Null off iOS.
export function useNotificationStatus(): NotificationStatus | null {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  useEffect(() => {
    if (!ios) return;
    const refresh = () => void Notifications.getPermissionsAsync().then((permissions) => setStatus(statusOf(permissions))).catch(() => undefined);
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, []);
  return status;
}

// iOS asks once; after that the system settings are the only place the answer changes.
export async function enableNotifications(status: NotificationStatus | null): Promise<void> {
  if (status === 'undetermined') return ask();
  await Linking.openSettings();
}

// Alerts delivered while wizzle was away are spent once it is in front; the root layout calls this on active.
export function clearDelivered(): void {
  if (!ios) return;
  void Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  void Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

// iOS only: registers the APNs token with the relay and turns a tapped alert into the right pairing.
export function startPush(): () => void {
  if (!ios) return () => undefined;
  let asked = false;
  let handled: string | null = null;
  const onResponse = (response: Notifications.NotificationResponse | null): void => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (id === handled) return;
    handled = id;
    // Otherwise a later launch that no tap caused would get the same response back and switch again.
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    const pairingId = pairingIdFromNotification(response.notification.request.content.data);
    if (pairingId) connection.select(pairingId);
    try {
      router.navigate('/');
    } catch (err) {
      console.warn('wizzle: could not open the conversation list', err);
    }
  };
  // A token granted in an earlier run is sent right away; the prompt waits for the first connected bridge.
  void Notifications.getPermissionsAsync()
    .then((status) => (status.granted ? register() : undefined))
    .catch(() => undefined);
  const unsubscribe = connection.subscribe(() => {
    const snapshot = connection.getSnapshot();
    if (asked || snapshot.phase !== 'connected' || !snapshot.pairing) return;
    asked = true;
    void ask().catch((err: unknown) => console.warn('wizzle: notification permission request failed', err));
  });
  const tokens = Notifications.addPushTokenListener((token) => {
    const next = tokenOf(token);
    if (next) connection.setPushToken(next);
  });
  const responses = Notifications.addNotificationResponseReceivedListener(onResponse);
  // Covers a tap that launched the app, when no listener was there to see it.
  void Notifications.getLastNotificationResponseAsync()
    .then(onResponse)
    .catch(() => undefined);
  clearDelivered();
  return () => {
    unsubscribe();
    tokens.remove();
    responses.remove();
  };
}
