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
        // Identidade visual Enemeop Flores — navy escuro + dourado
        bg: {
          base:    '#0F1826',   // navy profundo — fundo principal
          surface: '#162035',   // navy médio — cards e painéis
          raised:  '#1E2D47',   // navy claro — hover / inputs
        },
        gold: {
          DEFAULT: '#C9A84C',   // dourado exato do logo
          light:   '#DFC06E',   // hover
          subtle:  '#2A2210',   // fundo sutil dourado sobre navy
          dim:     '#7A6530',   // desabilitado
        },
        border: {
          DEFAULT: '#1E2D47',   // borda base navy
          strong:  '#2D4166',   // borda em hover/foco
        },
        text: {
          primary: '#EDE8DA',   // creme quente — leitura sobre navy
          muted:   '#8A9BB8',   // texto secundário azul-acinzentado
          faint:   '#4A5E7A',   // rótulos muito sutis
        },
        status: {
          success: '#4DC98A',
          warning: '#E8A84C',
          error:   '#E85C4C',
          info:    '#6EB0FF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        gold:       '0 0 0 1px rgba(201,168,76,0.25)',
        'gold-md':  '0 4px 32px rgba(201,168,76,0.10), 0 1px 4px rgba(0,0,0,0.4)',
        'gold-lg':  '0 8px 48px rgba(201,168,76,0.15), 0 2px 8px rgba(0,0,0,0.5)',
        card:       '0 1px 4px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
};

export default config;
