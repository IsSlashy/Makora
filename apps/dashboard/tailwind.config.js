/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'bg-void': '#050508',
        'bg-card': '#0a0a12',
        'bg-card-hover': '#0f0f1a',
        'bg-inner': '#08080e',
        'cursed': {
          DEFAULT: '#00E5FF',
          light: '#67EFFF',
          dim: '#00B4D8',
          faint: 'rgba(0, 229, 255, 0.08)',
        },
        'shadow-purple': '#00B4D8',
        'shadow-deep': '#005F73',
        'text-primary': '#f0edf5',
        'text-secondary': '#787580',
        'text-muted': '#4a4750',
        'positive': '#22c55e',
        'negative': '#ef4444',
        'caution': '#eab308',
      },
      fontFamily: {
        'display': ['"Bebas Neue"', '"Impact"', 'sans-serif'],
        'mono': ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      animation: {
        'wheel-spin': 'wheel-spin 20s linear infinite',
        'wheel-pulse': 'wheel-pulse 3s ease-in-out infinite',
        'cursed-glow': 'cursed-glow 2s ease-in-out infinite',
        'fade-up': 'fade-up 0.6s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'wheel-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'wheel-pulse': {
          '0%, 100%': { filter: 'drop-shadow(0 0 20px rgba(0, 229, 255, 0.3))' },
          '50%': { filter: 'drop-shadow(0 0 60px rgba(0, 229, 255, 0.7))' },
        },
        'cursed-glow': {
          '0%, 100%': { boxShadow: '0 0 15px rgba(0, 229, 255, 0.2), inset 0 0 15px rgba(0, 229, 255, 0.05)' },
          '50%': { boxShadow: '0 0 30px rgba(0, 229, 255, 0.4), inset 0 0 30px rgba(0, 229, 255, 0.1)' },
        },
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(20px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      backgroundImage: {
        'shimmer-gold': 'linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.08), transparent)',
      },
    },
  },
  plugins: [],
}
