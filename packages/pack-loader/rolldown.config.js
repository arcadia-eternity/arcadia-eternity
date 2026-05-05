import { createPackageConfig } from '../../scripts/rolldown-shared.js'

export default createPackageConfig({
  input: {
    index: 'index.ts',
    'generate-pack-lockfile': 'src/generate-pack-lockfile.ts',
  },
})
