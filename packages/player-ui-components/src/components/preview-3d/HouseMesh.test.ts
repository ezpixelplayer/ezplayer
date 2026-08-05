/**
 * URL rewriting for MTL-referenced textures.
 *
 * MTLLoader resolves a texture against the *directory* of the MTL's own URL, so a texture
 * referenced as `map_Kd texture_1001.png` arrives here as `<base><show-file dir>texture_1001.png`.
 * These cases pin that recovery to the real endpoint path: when the endpoint moved under
 * `/api/ezp/`, a hardcoded `/api/` strip left `ezp/` glued to the filename and every mesh
 * texture 404'd.
 */

import { describe, it, expect } from 'vitest';
import { createAssetLoadingManager } from './HouseMesh';
import { SHOW_FILE_DIR, SHOW_FILE_PATH, type AssetResolver } from '../../services/assetResolver';

/** Echoes the path it was asked for, so assertions read as "what did we look up?". */
const echoResolver: AssetResolver = (path) => `resolved:${path}`;

const OBJ_DIR = 'HouseModel/';

// Written out rather than built from SHOW_FILE_DIR: these must match the route the
// player's Koa server actually serves (server-worker.ts `/api/ezp/show-file`). Deriving
// them from the constant would make the tests move with a wrong constant.
const SERVED_DIR = '/api/ezp/';

describe('show-file endpoint constants', () => {
    it('match the route the player serves', () => {
        expect(SHOW_FILE_DIR).toBe(SERVED_DIR);
        expect(SHOW_FILE_PATH).toBe('/api/ezp/show-file');
    });
});

describe('createAssetLoadingManager — MTL texture resolution', () => {
    it('recovers the filename from an absolute show-file-relative texture URL', () => {
        const lm = createAssetLoadingManager(echoResolver, OBJ_DIR, 'http://localhost:3000');
        const url = `http://localhost:3000${SERVED_DIR}texture_1001.png`;
        expect(lm.resolveURL(url)).toBe('resolved:HouseModel/texture_1001.png');
    });

    it('recovers the filename behind a path-only cloud proxy base', () => {
        const base = '/api/enduserspa/proxy/tok123';
        const lm = createAssetLoadingManager(echoResolver, OBJ_DIR, base);
        expect(lm.resolveURL(`${base}${SERVED_DIR}texture_1002.png`)).toBe(
            'resolved:HouseModel/texture_1002.png',
        );
    });

    it('resolves a plain relative texture name against the OBJ directory', () => {
        const lm = createAssetLoadingManager(echoResolver, OBJ_DIR, 'http://localhost:3000');
        expect(lm.resolveURL('texture_1001.png')).toBe('resolved:HouseModel/texture_1001.png');
    });

    it('passes an already-resolved show-file URL through untouched', () => {
        const lm = createAssetLoadingManager(echoResolver, OBJ_DIR, 'http://localhost:3000');
        const resolved = `http://localhost:3000${SERVED_DIR}show-file?path=HouseModel%2FKR.mtl`;
        expect(lm.resolveURL(resolved)).toBe(resolved);
    });

    it('passes data: URIs and third-party origins through untouched', () => {
        const lm = createAssetLoadingManager(echoResolver, OBJ_DIR, 'http://localhost:3000');
        expect(lm.resolveURL('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(lm.resolveURL('https://cdn.example.com/t.png')).toBe('https://cdn.example.com/t.png');
    });

    it('strips a blob: base that MTLLoader appended a filename to, but not a bare blob URL', () => {
        const lm = createAssetLoadingManager(echoResolver, OBJ_DIR, undefined);
        const bare = 'blob:http://localhost:3000/2b1e6a3c-7d4f-4a1e-9c2b-0f5a8d3e7c11';
        expect(lm.resolveURL(bare)).toBe(bare);
        expect(lm.resolveURL(`${bare}/texture_1001.png`)).toBe('resolved:HouseModel/texture_1001.png');
    });

    it('falls back to the original URL when the resolver has nothing', () => {
        const lm = createAssetLoadingManager(() => null, OBJ_DIR, 'http://localhost:3000');
        expect(lm.resolveURL('texture_1001.png')).toBe('texture_1001.png');
    });
});
