import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { TamaguiProvider, useTheme } from 'tamagui';
import { startPush } from '../src/push';
import { connection } from '../src/relay/connection';
import { store } from '../src/store';
import { useAppearance } from '../src/ui/appearance';
import { useAppFonts } from '../src/ui/fonts';
import { chatTitle, decodeId, profileTitle } from '../src/ui/titles';
import { tamaguiConfig } from '../tamagui.config';

// useColorScheme also reports null or unspecified, and treating those as light flips every screen
// and the native header for that frame, so the last real answer is kept instead.
function useScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  const appearance = useAppearance();
  const last = useRef<'light' | 'dark'>('light');
  if (scheme === 'light' || scheme === 'dark') last.current = scheme;
  return appearance === 'system' ? last.current : appearance;
}

export default function RootLayout() {
  const scheme = useScheme();
  const fontsReady = useAppFonts();
  useEffect(() => {
    connection.start();
    const stopPush = startPush();
    // Background closes the socket so the relay pushes instead of writing to an app that is gone.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') connection.suspend();
      if (state === 'active') {
        connection.resume();
        connection.wake();
      }
    });
    return () => {
      sub.remove();
      stopPush();
    };
  }, []);
  if (!fontsReady) return null;
  return (
    <KeyboardProvider>
      <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <RootStack scheme={scheme} />
      </TamaguiProvider>
    </KeyboardProvider>
  );
}

// The native header takes its colors from the Tamagui theme so it matches the screens. The stack's
// native container sits behind the screens and shows when a back swipe springs past the edge.
function RootStack({ scheme }: { scheme: 'light' | 'dark' }) {
  const theme = useTheme();
  const appearance = useAppearance();
  const background = theme.background.val;
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background } };
  }, [scheme, background]);
  return (
    <ThemeProvider value={navTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background.val },
          headerTintColor: theme.color.val,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: theme.background.val },
          // On System the native bar takes light or dark from iOS instead of being forced from the JS theme.
          unstable_nativeProps: {
            headerConfig: { experimental_userInterfaceStyle: appearance === 'system' ? 'unspecified' : scheme },
          },
        }}
      >
        {/* An element and an agent's profile open over whatever linked to them. */}
        <Stack.Screen name="element" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="profile"
          options={({ route }) => ({
            presentation: 'modal',
            title: profileTitle(store.getSnapshot(), (route.params as { agent?: string } | undefined)?.agent ?? ''),
          })}
        />
        <Stack.Screen
          name="chat/[conv]"
          options={({ route }) => ({ title: chatTitle(store.getSnapshot(), decodeId((route.params as { conv?: string } | undefined)?.conv)) })}
        />
      </Stack>
    </ThemeProvider>
  );
}
