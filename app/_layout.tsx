import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { TamaguiProvider, useTheme } from 'tamagui';
import { connection } from '../src/relay/connection';
import '../src/store';
import { useAppFonts } from '../src/ui/fonts';
import { tamaguiConfig } from '../tamagui.config';

// useColorScheme also reports null or unspecified, and treating those as light flips every screen
// and the native header for that frame, so the last real answer is kept instead.
function useScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  const last = useRef<'light' | 'dark'>('light');
  if (scheme === 'light' || scheme === 'dark') last.current = scheme;
  return last.current;
}

export default function RootLayout() {
  const scheme = useScheme();
  const fontsReady = useAppFonts();
  useEffect(() => {
    connection.start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') connection.wake();
    });
    return () => sub.remove();
  }, []);
  if (!fontsReady) return null;
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <StatusBar style="auto" />
      <RootStack />
    </TamaguiProvider>
  );
}

// The native header takes its colors from the Tamagui theme so it matches the screens.
function RootStack() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background.val },
        headerTintColor: theme.color.val,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background.val },
      }}
    />
  );
}
