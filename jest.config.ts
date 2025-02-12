module.exports = {
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testRegex: '(/tests/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  moduleFileExtensions: ['tsx', 'ts', 'js', 'jsx', 'json', 'node'],
}
