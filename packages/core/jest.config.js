module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^\\.\/storesStorage$': '<rootDir>/storesStorage.web.ts',
    '^\\.\/env$': '<rootDir>/env.web.ts',
  },
};
