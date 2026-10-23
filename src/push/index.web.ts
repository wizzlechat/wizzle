// Push is iOS only; the web bundle must not pull in the native notification module.
export function startPush(): () => void {
  return () => undefined;
}
