import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';
import { connection } from '../relay/connection.ts';
import { pairingIdFromNotification } from './notification.ts';

const ios = Platform.OS === 'ios';

// The relay's alert is a wake for a phone that is away; in the foreground the socket already carries the news.
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

function clearDelivered(): void {
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
    void Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })
      .then((status) => (status.granted ? register() : undefined))
      .catch((err: unknown) => console.warn('wizzle: notification permission request failed', err));
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
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') clearDelivered();
  });
  clearDelivered();
  return () => {
    unsubscribe();
    tokens.remove();
    responses.remove();
    appState.remove();
  };
}
