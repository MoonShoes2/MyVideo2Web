/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-variant': 'var(--surface-variant)',
        'surface-high': 'var(--surface-high)',
        ink: 'var(--text)',
        muted: 'var(--text-secondary)',
        divider: 'var(--divider)',
        brand: 'var(--brand)',
        'brand-deep': 'var(--brand-deep)',
        gold: 'var(--gold)',
        danger: 'var(--danger)',
        success: 'var(--success)',
        placeholder: 'var(--poster-placeholder)',
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
    },
  },
  plugins: [],
}
