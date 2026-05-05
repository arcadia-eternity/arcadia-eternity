import { createPackageConfig } from '../../scripts/rolldown-shared.js'
import copy from 'rollup-plugin-copy'

export default createPackageConfig({
  plugins: [
    copy({
      targets: [
        {
          src: 'src/templates/**/*',
          dest: 'dist/src/templates',
        },
      ],
    }),
  ],
})
