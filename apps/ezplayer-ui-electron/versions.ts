import { type EZPlayerVersions } from '@ezplayer/ezplayer-core';

// Build-time version numbers
import mainPkg from "../../package.json" assert { type: "json" };
import appPkg from "./package.json" assert { type: "json" };
import eppPkg from "../../packages/epp/package.json" assert { type: "json" };
import corePkg from "../../packages/ezplayer-core/package.json" assert { type: "json" };
import uiPkg from "../../packages/player-ui-components/package.json" assert { type: "json" };

// types/build-constants.d.ts
declare const __BUILD_DATE__: string;
declare const __GIT_SHA__: string;
declare const __GIT_BRANCH__: string;
declare const __GIT_TAG__: string;
declare const __GIT_REPO__: string;

export const BUILD_INFO = {
    name: 'EZPlayer',
    version: mainPkg.version,
    builtAtIso: __BUILD_DATE__, // inlined at build time
    arch: `${process.platform} ${process.arch}`,
    git: {
        repo: __GIT_REPO__,
        branch: __GIT_BRANCH__,
        tag: __GIT_TAG__,
        sha: __GIT_SHA__,
    },
    packages: {
        "Electron App": appPkg.version,
        "EPP": eppPkg.version,
        "Player Core": corePkg.version,
        "Player UI": uiPkg.version,
    },
} as const;

export const ezpVersions: EZPlayerVersions = {
    ...BUILD_INFO,
    processes: process.versions
}
