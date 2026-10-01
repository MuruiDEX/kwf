/** @type {import('tailwindcss').Config} */
export default { content: ['./index.html', './src/**/*.{ts,tsx}'], darkMode: 'class',
  theme: { extend: { colors: { navy: '#071A33', surface: '#F6F7F9', golddim: '#C9A227', ink: '#05080D' },
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] } } } }
