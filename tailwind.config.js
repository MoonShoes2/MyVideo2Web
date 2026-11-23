/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // 用 RGB 通道变量 + <alpha-value>，让 bg-brand/15、text-muted/50 等透明度变体
      // 能被 Tailwind 正确生成（裸 var(--xxx) 颜色无法注入 alpha，/15 类会被丢弃）。
      colors: {
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        'surface-variant': 'rgb(var(--surface-variant-rgb) / <alpha-value>)',
        'surface-high': 'rgb(var(--surface-high-rgb) / <alpha-value>)',
        ink: 'rgb(var(--text-rgb) / <alpha-value>)',
        muted: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
        divider: 'rgb(var(--divider-rgb) / <alpha-value>)',
        brand: 'rgb(var(--brand-rgb) / <alpha-value>)',
        'brand-deep': 'rgb(var(--brand-deep-rgb) / <alpha-value>)',
        gold: 'rgb(var(--gold-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        placeholder: 'rgb(var(--poster-placeholder-rgb) / <alpha-value>)',
      },
      fontSize: {
        'title-lg': ['19px', { lineHeight: '26px', fontWeight: '600' }],
        'title-md': ['16px', { lineHeight: '22px', fontWeight: '600' }],
        'title-sm': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'body-lg': ['15px', { lineHeight: '23px' }],
        'body-md': ['13px', { lineHeight: '19px' }],
        'body-sm': ['11.5px', { lineHeight: '16px' }],
        'label-lg': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'label-md': ['12px', { lineHeight: '16px', fontWeight: '500' }],
        'label-sm': ['10.5px', { lineHeight: '14px' }],
      },
      borderRadius: {
        card: '14px',
        poster: '8px',
      },
      // 播放器/卡片用到很多非 5 倍数的透明度（进度轨 /22 /38、遮罩 /66 /78 等），
      // Tailwind 默认刻度只有 5 的倍数，这些类不会生成，必须显式补齐。
      opacity: {
        8: '0.08',
        12: '0.12',
        18: '0.18',
        22: '0.22',
        28: '0.28',
        38: '0.38',
        42: '0.42',
        45: '0.45',
        55: '0.55',
        62: '0.62',
        66: '0.66',
        72: '0.72',
        78: '0.78',
        85: '0.85',
        92: '0.92',
        94: '0.94',
      },
    },
  },
  plugins: [],
}
