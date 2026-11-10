import { isBuiltin } from 'node:module'
import { isAbsolute } from 'node:path'
import { defineConfig } from 'tsdown'

const shared = ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']
const bare = (id: string): boolean => !id.startsWith('.') && !isAbsolute(id) && !isBuiltin(id)

export default defineConfig([
  {
    entry: { node: 'src/node/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node',
    target: 'es2024', fixedExtension: false, dts: false, sourcemap: true, clean: true,
    deps: { neverBundle: bare, alwaysBundle: id => !isBuiltin(id) && !bare(id) },
    outputOptions: { entryFileNames: '[name].js' },
  },
  {
    entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs', platform: 'browser',
    inputOptions: { tsconfig: false }, dts: false, sourcemap: true, clean: false,
    deps: { neverBundle: id => shared.includes(id), alwaysBundle: id => !shared.includes(id) },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-novelai", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
