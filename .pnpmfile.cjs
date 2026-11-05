module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== 'better-auth' || pkg.version !== '1.7.13') return pkg
      // Arcadia uses authentication entry points, never better-auth/test.
      // pnpm 11 restores a deleted optional peer from peerDependenciesMeta,
      // so both declarations must be omitted to keep Vitest out of production.
      if (pkg.dependencies?.vitest !== undefined || pkg.optionalDependencies?.vitest !== undefined)
        throw new Error('Better Auth Vitest must remain a reviewed optional peer, not a runtime dependency')
      const peer = pkg.peerDependencies?.vitest
      const meta = pkg.peerDependenciesMeta?.vitest
      if (peer === undefined && meta === undefined) return pkg
      if (typeof peer !== 'string' || meta?.optional !== true)
        throw new Error('Better Auth Vitest peer metadata changed; review the production dependency policy')
      const peerDependencies = { ...pkg.peerDependencies }
      const peerDependenciesMeta = { ...pkg.peerDependenciesMeta }
      delete peerDependencies.vitest
      delete peerDependenciesMeta.vitest
      return { ...pkg, peerDependencies, peerDependenciesMeta }
    },
  },
}
