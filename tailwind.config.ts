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
        // Identidade visual Enemeop Flores — fundo escuro quente + dourado
        bg: {
          base:    '#0D0900',   // fundo mais profundo, próximo ao cartão físico
          surface: '#181005',   // superfície de cards
          raised:  '#211608',   // hover / inputs
        },
        gold: {
          DEFAULT: '#C9A84C',
          light:   '#E2C06E',   // hover states
          subtle:  '#F5EDD6',   // texto sobre fundo escuro
          dim:     '#7A6530',   // desabilitado
        },
        border: {
          DEFAULT: '#332614',   // borda base (um pouco mais visível)
          strong:  '#50391A',   // borda em hover/foco
        },
        text: {
          primary: '#F0E6C8',   // texto principal — creme quente
          muted:   '#9C8160',   // texto secundário
          faint:   '#5E4A2C',   // texto muito sutil / rótulos
        },
        status: {
          success: '#52C97C',
          warning: '#E8A84C',
          error:   '#E85C4C',
          info:    '#6EB0FF',   // azul mais claro para destacar no fundo escuro
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        gold:    '0 0 0 1px rgba(201,168,76,0.25)',
        'gold-md': '0 4px 32px rgba(201,168,76,0.10), 0 1px 4px rgba(0,0,0,0.4)',
        'gold-lg': '0 8px 48px rgba(201,168,76,0.15), 0 2px 8px rgba(0,0,0,0.5)',
      },
      backgroundImage: {
        'radial-[ellipse_at_center]': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
