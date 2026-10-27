import { describe, expect, it } from 'vitest';
import {
    describeExitCode,
    GPU_FALLBACK_MAX_UPTIME_S,
    parseGpuModeEnv,
    shouldFallbackToSoftwareGpu,
    SOFTWARE_GL_SWITCHES,
} from './rendererCrashPolicy';

const base = {
    reason: 'crashed',
    uptimeS: 1,
    gpuProcessAlive: false,
    gpuProcessFaulted: false,
    gpuAlreadyDisabled: false,
    alreadyTriggered: false,
};

describe('shouldFallbackToSoftwareGpu', () => {
    it('fires for a crash at startup with no GPU process', () => {
        expect(shouldFallbackToSoftwareGpu(base)).toBe(true);
    });

    it('fires for a crash later in the window with no GPU process', () => {
        expect(shouldFallbackToSoftwareGpu({ ...base, uptimeS: 50 })).toBe(true);
    });

    it('does not fire when a GPU process is alive', () => {
        expect(shouldFallbackToSoftwareGpu({ ...base, gpuProcessAlive: true })).toBe(false);
    });

    it('fires when the GPU process itself died earlier, even if one is alive again', () => {
        expect(shouldFallbackToSoftwareGpu({ ...base, gpuProcessAlive: true, gpuProcessFaulted: true })).toBe(true);
    });

    it('does not fire once --disable-gpu is already in effect', () => {
        expect(shouldFallbackToSoftwareGpu({ ...base, gpuAlreadyDisabled: true })).toBe(false);
    });

    it('fires only once per run even when several renderers die', () => {
        expect(shouldFallbackToSoftwareGpu({ ...base, alreadyTriggered: true })).toBe(false);
    });

    it('ignores late crashes', () => {
        expect(shouldFallbackToSoftwareGpu({ ...base, uptimeS: GPU_FALLBACK_MAX_UPTIME_S + 1 })).toBe(false);
    });

    it('ignores non-fault reasons', () => {
        for (const reason of ['oom', 'killed', 'clean-exit']) {
            expect(shouldFallbackToSoftwareGpu({ ...base, reason })).toBe(false);
        }
    });
});

describe('SOFTWARE_GL_SWITCHES', () => {
    it('turns the GPU off and routes WebGL to SwiftShader', () => {
        const names = SOFTWARE_GL_SWITCHES.map(([n]) => n);
        expect(names).toContain('disable-gpu');
        expect(SOFTWARE_GL_SWITCHES).toContainEqual(['use-angle', 'swiftshader']);
        expect(names).toContain('enable-unsafe-swiftshader');
    });
});

describe('parseGpuModeEnv', () => {
    it('accepts the documented values and aliases', () => {
        expect(parseGpuModeEnv('hardware')).toBe('hardware');
        expect(parseGpuModeEnv(' GPU ')).toBe('hardware');
        expect(parseGpuModeEnv('software')).toBe('software');
        expect(parseGpuModeEnv('sw')).toBe('software');
    });

    it('rejects unknown or missing values', () => {
        expect(parseGpuModeEnv(undefined)).toBeUndefined();
        expect(parseGpuModeEnv('')).toBeUndefined();
        expect(parseGpuModeEnv('yes')).toBeUndefined();
    });
});

describe('describeExitCode', () => {
    it('decodes a signal without and with a core dump', () => {
        expect(describeExitCode(4, 'linux')).toBe('SIGILL');
        expect(describeExitCode(132, 'linux')).toBe('SIGILL, core dumped');
    });

    it('decodes other signals and plain exits', () => {
        expect(describeExitCode(11, 'linux')).toBe('SIGSEGV');
        expect(describeExitCode(139, 'darwin')).toBe('SIGSEGV, core dumped');
        expect(describeExitCode(0x100, 'linux')).toBe('exit 1');
        expect(describeExitCode(0, 'linux')).toBe('exit 0');
    });

    it('shows Windows codes as NTSTATUS hex', () => {
        expect(describeExitCode(-1073741510, 'win32')).toBe('0xC000013A');
        expect(describeExitCode(1073807364, 'win32')).toBe('0x40010004');
    });
});
