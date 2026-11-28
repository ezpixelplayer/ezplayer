import { describe, expect, it } from 'vitest';
import type { AppsState } from '@ezplayer/ezplayer-core';
import { AppsApiDeps, AppsRuntime } from './apps-api';

function runtime(mappings: AppsState['inputMappings']) {
    const apps: AppsState = { apps: [], instances: [], defaultSchedule: [], inputMappings: mappings };
    const deps: AppsApiDeps = {
        appsCommand: async () => apps,
        sawStatus: () => undefined,
        getState: (key) => (key === 'apps' ? (apps as never) : undefined),
        setState: () => undefined,
    };
    return new AppsRuntime(deps);
}

const entry = { appId: 'g', appDir: '', dataDir: '', inputs: ['pose'], token: 't', running: true, title: 'Game' };

describe('recent show inputs', () => {
    it('remembers every post, mapped or not, newest first with a value preview', () => {
        const rt = runtime([{ source: 'wand-sim', name: 'pose', instance: 'game', input: 'pose' }]);
        rt.setInstances({ game: entry });
        const wand = { instance: 'wand', title: 'Wand Simulator' };
        expect(rt.input('button', 'start', undefined, { address: '10.0.0.5' })).toBe(0);
        expect(rt.input('wand-sim', 'pose', { x: 1, z: 2, yaw: 0, pitch: 10, on: true }, wand)).toBe(1);
        expect(rt.input('wand-sim', 'pose', { x: 1.5, z: 2, yaw: 0, pitch: 10, on: true }, wand)).toBe(1);
        const recent = rt.recentInputs();
        expect(recent.map((r) => `${r.source}/${r.name}`)).toEqual(['wand-sim/pose', 'button/start']);
        expect(recent[0].count).toBe(2);
        expect(recent[0].delivered).toBe(1);
        expect(recent[0].lastValue).toBe('{"x":1.5,"z":2,"yaw":0,"pitch":10,"on":true}');
        expect(recent[0].shape).toBe('object');
        expect(recent[0].sender).toEqual(wand);
        expect(recent[1].sender).toEqual({ address: '10.0.0.5' });
        // Posts by an instance count as inputs it sent; a board's do not count for anyone.
        expect(rt.takeTraffic()).toEqual({ wand: { requests: 0, events: 0, sent: 2 } });
        expect(recent[1].delivered).toBe(0);
        expect(recent[1].lastValue).toBeUndefined();
        expect(recent[1].shape).toBe('none');
    });

    it('keeps only the newest fifty and trims long values', () => {
        const rt = runtime([]);
        for (let i = 0; i < 60; ++i) rt.input('board', `b${i}`, 'x'.repeat(200));
        const recent = rt.recentInputs();
        expect(recent).toHaveLength(50);
        expect(recent[0].name).toBe('b59');
        expect(recent[49].name).toBe('b10');
        expect(recent[0].lastValue!.length).toBe(60);
        expect(recent[0].shape).toBe('text');
    });
});
