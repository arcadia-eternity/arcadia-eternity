import { V2DataRepository } from './v2-data-repository.js';
export interface V2DataPackManifest {
    id: string;
    version: string;
    engine: 'seer2-v2';
    layoutVersion?: 1;
    dependencies?: V2DataPackDependency[];
    paths?: {
        dataDir?: string;
        localesDir?: string;
    };
    data: {
        effects: string[];
        marks: string[];
        skills: string[];
        species: string[];
    };
    locales?: Record<string, string[]> | Array<{
        locale: string;
        files?: string[];
        namespaces?: string[];
    }>;
}
export interface V2DataPackDependency {
    path: string;
    id?: string;
    optional?: boolean;
}
export type LocaleBundles = Record<string, Record<string, unknown>>;
export interface LoadOptions {
    continueOnError?: boolean;
    validateReferences?: boolean;
    packPath?: string;
    packRef?: string;
}
export interface LoadResult {
    repository: V2DataRepository;
    errors: string[];
    pack?: V2DataPackManifest;
    locales?: LocaleBundles;
}
/**
 * Load all YAML game data from a directory into a V2DataRepository.
 *
 * Files are loaded in dependency order:
 * 1. effect_*.yaml → effects
 * 2. mark_*.yaml → marks (depend on effects)
 * 3. skill*.yaml → skills (depend on effects)
 * 4. species*.yaml → species (depend on marks for ability/emblem)
 *
 * @param dataDir - Directory containing YAML files
 * @param options - Loading options
 * @returns Repository and any errors encountered
 */
export declare function loadV2GameData(_dataDir: string, options?: LoadOptions): Promise<LoadResult>;
export declare function loadV2GameDataFromPack(packRef: string, options?: Omit<LoadOptions, 'packPath'>): Promise<LoadResult>;
export declare function resolvePackPathFromRef(packRef: string): Promise<string>;
//# sourceMappingURL=v2-data-loader.d.ts.map