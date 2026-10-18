const at = (root, path) => path.reduce((value, key) => value?.[key], root)
const pointer = path => '/' + path.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')
export function relevant(issues, root) {
  return issues.flatMap(issue => {
    if (issue.code !== 'invalid_union')
      return [
        {
          path: pointer(issue.path),
          code: issue.code,
          message: issue.message,
          ...(issue.code === 'invalid_enum_value' ? { received: issue.received, allowed: issue.options } : {}),
        },
      ]
    // Ignore union alternatives that reject the actual node's discriminator or container kind.
    const branches = issue.unionErrors.filter(
      branch =>
        !branch.issues.some(
          child =>
            (child.code === 'invalid_literal' && pointer(child.path) === pointer([...issue.path, 'type'])) ||
            (child.code === 'invalid_type' && pointer(child.path) === pointer(issue.path)),
        ),
    )
    if (!branches.length)
      return [{ path: pointer(issue.path), code: 'unsupported_variant', value: at(root, issue.path) }]
    return branches.flatMap(branch => relevant(branch.issues, root))
  })
}
