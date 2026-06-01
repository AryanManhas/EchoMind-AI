export const theme = {
  colors: {
    surface: '#0e0e12', // Main background
    surfaceContainerLow: '#131317', // Cards, BottomNav, TopNav
    outlineVariant: '#48474c', // 15% opacity fallback borders
    primary: '#c799ff',
    secondary: '#4af8e3',
    tertiary: '#fbbf24',
    textPrimary: '#fcf8fe',
    textSecondary: 'rgba(252, 248, 254, 0.5)',
    textTertiary: 'rgba(252, 248, 254, 0.35)',
    // Glass borders
    borderGhost: 'rgba(255, 255, 255, 0.05)',
    borderSubtle: 'rgba(255, 255, 255, 0.02)',
    // Gradients
    glassBg: 'rgba(255, 255, 255, 0.03)',
    glassBgHighlight: 'rgba(255, 255, 255, 0.05)',
  },
  typography: {
    headers: {
      fontFamily: 'System', // Fallback for Manrope
      fontWeight: '800' as const,
      letterSpacing: -0.5,
    },
    body: {
      fontFamily: 'System', // Fallback for Inter
      fontWeight: '400' as const,
      lineHeight: 24,
    },
    labels: {
      fontFamily: 'System', // Fallback for Plus Jakarta Sans
      fontWeight: '600' as const,
      letterSpacing: 0.5,
      textTransform: 'uppercase' as const,
    }
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    round: 9999,
  }
};
