import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        border: 'var(--border)',
        'border-soft': 'var(--border-soft)',
        fg: 'var(--fg)',
        'fg-dim': 'var(--fg-dim)',
        'fg-faint': 'var(--fg-faint)',
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        'accent-3': 'var(--accent-3)',
        'accent-4': 'var(--accent-4)',
        'status-ai-edit': 'var(--status-ai-edit)',
        'status-ai-edit-contrast': 'var(--status-ai-edit-contrast)',
        'status-running': 'var(--status-running)',
        'status-running-contrast': 'var(--status-running-contrast)',
        'status-success': 'var(--status-success)',
        'status-success-contrast': 'var(--status-success-contrast)',
        'status-error': 'var(--status-error)',
        'status-error-contrast': 'var(--status-error-contrast)',
        'status-interrupted': 'var(--status-interrupted)',
        'status-interrupted-contrast': 'var(--status-interrupted-contrast)',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
