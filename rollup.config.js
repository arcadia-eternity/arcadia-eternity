import typescript from '@rollup/plugin-typescript';

export default {
  input: 'test.ts',
  output: {
    dir: 'dist',
    format: 'cjs',
  },
  plugins: [typescript({ tsconfig: './tsconfig.json' })],
};
