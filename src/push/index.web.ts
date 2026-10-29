// Push is iOS only; the web bundle must not pull in the native notification module.
export type NotificationStatus = 'granted' | 'denied' | 'undetermined';

export function startPush(): () => void {
  return () => undefined;
}

export function clearDelivered(): void {}

export function useNotificationStatus(): NotificationStatus | null {
  return null;
}

export function enableNotifications(_status: NotificationStatus | null): Promise<void> {
  return Promise.resolve();
}
