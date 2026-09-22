// Clock time for today, a short date for anything older.
export function shortTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  if (new Date(now).toDateString() === date.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}
