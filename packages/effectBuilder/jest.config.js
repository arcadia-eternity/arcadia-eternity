// jest.config.cjs
export const preset = 'ts-jest/presets/default-esm';
export const testEnvironment = 'node';
export const extensionsToTreatAsEsm = ['.ts'];
export const moduleNameMapper = {
    '^(\\.{1,2}/.*)\\.js$': '$1', // 帮助 Jest 处理 ESM 的路径映射
};
export const transform = {
    '^.+\\.tsx?$': [
        'ts-jest',
        {
            useESM: true, // 启用 ts-jest 的 ESM 支持
            tsconfig: 'tsconfig.json'
        }
    ]
};
export const transformIgnorePatterns = [
    // 排除所有 node_modules 除了需要转换的包
    '/node_modules/(?!(nanoid|other-esm-package)/)'
];