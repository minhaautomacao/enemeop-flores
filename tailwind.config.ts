import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Identidade visual Enemeop Flores — fundo escuro + dourado
        bg: {
          base:    '#0F0A02',
          surface: '#1A1208',
          raised:  '#231A0C',
        },
        gold: {
          DEFAULT: '#C9A84C',
          light:   '#E8C97A',
          subtle:  '#F5EDD6',
          dim:     '#7A6530',
        },
        border: {
          DEFAULT: '#3D3020',
          strong:  '#5A4828',
        },
        text: {
          primary: '#F5EDD6',
          muted:   '#A89070',
          faint:   '#6B5A3E',
        },
        status: {
          success: '#4CAF7D',
          warning: '#E8A84C',
          error:   '#E85C4C',
          info:    '#4C8CE8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        gold: '0 0 0 1px rgba(201,168,76,0.3)',
        'gold-md': '0 4px 24px rgba(201,168,76,0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
