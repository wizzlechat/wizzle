import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';

export type DictationState = 'idle' | 'starting' | 'listening';

const DENIED = 'Dictation needs the microphone and speech recognition. Allow both for wizzle in Settings.';

// The phrases heard so far; what was typed before the mic opened stays in front of them.
type Session = { prefix: string; finals: string[]; interim: string };

function deviceLang(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-US';
  }
}

function joined(session: Session): string {
  return [session.prefix.trimEnd(), ...session.finals, session.interim]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

// Speech into the message box. Recognition runs on Apple's servers, so it works without the on-device models.
export function useDictation(text: string, setText: (next: string) => void) {
  const [state, setState] = useState<DictationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

  // Events reach every mounted chat; only the one that opened the mic holds a session.
  useSpeechRecognitionEvent('start', () => {
    if (session.current) setState('listening');
  });
  useSpeechRecognitionEvent('result', (event) => {
    const current = session.current;
    if (!current) return;
    const transcript = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      if (transcript.length > 0) current.finals.push(transcript);
      current.interim = '';
    } else {
      current.interim = transcript;
    }
    setText(joined(current));
  });
  // Any other error ends the recognition, so the mic closes with it.
  useSpeechRecognitionEvent('error', (event) => {
    if (!session.current || event.error === 'aborted' || event.error === 'no-speech') return;
    session.current = null;
    setState('idle');
    setError(event.error === 'not-allowed' ? DENIED : event.message);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!session.current) return;
    session.current = null;
    setState('idle');
  });

  // Leaving the chat drops whatever is still being heard.
  useEffect(
    () => () => {
      if (session.current) ExpoSpeechRecognitionModule.abort();
      session.current = null;
    },
    [],
  );

  async function start(): Promise<void> {
    setError(null);
    setState('starting');
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setState('idle');
        setError(DENIED);
        return;
      }
      session.current = { prefix: text, finals: [], interim: '' };
      ExpoSpeechRecognitionModule.start({
        lang: deviceLang(),
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
      });
    } catch (err) {
      session.current = null;
      setState('idle');
      setError(err instanceof Error ? err.message : 'Dictation could not start.');
    }
  }

  // Stop keeps what was heard; cancel is for a send or a typed edit, so a late phrase never lands after it.
  function stop(): void {
    if (session.current) ExpoSpeechRecognitionModule.stop();
  }

  function cancel(): void {
    if (!session.current) return;
    session.current = null;
    ExpoSpeechRecognitionModule.abort();
    setState('idle');
  }

  function toggle(): void {
    if (state === 'idle') void start();
    else stop();
  }

  return { state, error, dismiss: () => setError(null), toggle, cancel };
}
