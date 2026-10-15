import { buildDshPlugin } from 'dsh-build-tools'

await buildDshPlugin({
  host: { loader: { '.md': 'text' } },
  modules: [
    { entry: 'src/host/vault.ts', out: 'vault.js', loader: { '.md': 'text' } },
    { entry: 'src/host/inbox.ts', out: 'inbox.js' },
    { entry: 'src/host/compliance.ts', out: 'compliance.js' },
    { entry: 'src/host/history.ts', out: 'history.js' },
    { entry: 'src/shared/reconcile.ts', out: 'reconcile.js' },
    { entry: 'src/shared/promote.ts', out: 'promote.js' },
    { entry: 'src/host/enabled.ts', out: 'enabled.js' },
  ],
})
