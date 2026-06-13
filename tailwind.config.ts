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
        // Identidade visual Enemeop Flores — fundo claro creme + dourado
        bg: {
          base:    '#FDFCF9',   // fundo principal — branco creme quente
          surface: '#F7F4EE',   // cards e painéis
          raised:  '#EEE9DF',   // hover / inputs
        },
        gold: {
          DEFAULT: '#9E7A1E',   // dourado rico sobre fundo claro
          light:   '#B8912A',   // hover
          subtle:  '#F5EDD6',   // fundo sutil dourado
          dim:     '#C9A84C',   // texto dourado decorativo
        },
        border: {
          DEFAULT: '#DDD6C8',   // borda base — quente
          strong:  '#C4BAA8',   // borda em hover/foco
        },
        text: {
          primary: '#1C1208',   // quase preto — marrom muito escuro
          muted:   '#6B5B45',   // texto secundário
          faint:   '#A8967E',   // rótulos e placeholders
        },
        status: {
          success: '#1E7A44',
          warning: '#A85E10',
          error:   '#9B2020',
          info:    '#1A5FA3',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        gold:       '0 0 0 1px rgba(158,122,30,0.2)',
        'gold-md':  '0 4px 24px rgba(158,122,30,0.08), 0 1px 4px rgba(0,0,0,0.06)',
        'gold-lg':  '0 8px 40px rgba(158,122,30,0.12), 0 2px 8px rgba(0,0,0,0.08)',
        card:       '0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
