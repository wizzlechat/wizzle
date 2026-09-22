import { createSystemFont, defaultConfig } from '@tamagui/config/v5';
import { animations } from '@tamagui/config/v5-rn';
import { Platform } from 'react-native';
import { createTamagui } from 'tamagui';

// Tamagui's small steps (12 to 15) read too small on a phone, so steps 1 to 6 go up two points.
const size = { 1: 14, 2: 15, 3: 16, 4: 17, true: 17, 5: 18, 6: 20 };

// Face names match the keys registered in src/ui/fonts.ts; web resolves weights through @font-face.
const inter = {
  family: Platform.OS === 'web' ? 'Inter, -apple-system, system-ui, sans-serif' : 'Inter',
  size,
  face: {
    400: { normal: 'Inter' },
    500: { normal: 'InterMedium' },
    600: { normal: 'InterSemiBold' },
    700: { normal: 'InterBold' },
    800: { normal: 'InterExtraBold' },
  },
};

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  animations,
  fonts: {
    body: createSystemFont({ font: inter }),
    heading: createSystemFont({
      font: { ...inter, weight: { 0: '600', 6: '700', 9: '800' } },
      sizeLineHeight: (size) => Math.round(size * 1.2),
    }),
  },
});

export default tamaguiConfig;

export type AppConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}
