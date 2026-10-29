import { useEffect, useState } from 'react';

// True once the clock passes `at`, with one timer waiting for it. Undefined never arrives.
export function useDeadline(at: number | undefined): boolean {
  const [passed, setPassed] = useState(() => at !== undefined && at <= Date.now());
  useEffect(() => {
    if (at === undefined) {
      setPassed(false);
      return;
    }
    const left = at - Date.now();
    if (left <= 0) {
      setPassed(true);
      return;
    }
    setPassed(false);
    const timer = setTimeout(() => setPassed(true), left);
    return () => clearTimeout(timer);
  }, [at]);
  return passed;
}
