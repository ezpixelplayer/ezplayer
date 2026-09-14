import { describe, it, expect } from 'vitest';
import { reconcilePanelMatrices, reconcileVirtualMatrices, hasPortDrift } from '../src/util/controllerReconcile';
import { buildPortMap } from '../src/util/controllerPortMap';
import type { ControllerPanelMatrixIntent, ControllerVirtualMatrixIntent } from '../src/types/ControllerOps';

// The krlights "Tune To" sign: one 192x32 matrix model on panel matrix 1.
const tuneTo: ControllerPanelMatrixIntent = {
    port: 1,
    models: ['Tune To'],
    startChannel: 114586,
    channels: 18432,
    protocol: 'LED Panel Matrix',
    width: 192,
    height: 32,
};
const colorLight = { port: 1, driver: 'ColorLight5a75', enabled: true, startChannel: 114586, channels: 18432 };

describe('reconcilePanelMatrices', () => {
    it('is in sync when the matrix is enabled at the intended start and big enough', () => {
        const [row] = reconcilePanelMatrices([tuneTo], [colorLight]);
        expect(row).toMatchObject({ port: 1, drift: 'ok', notes: [], actualDriver: 'ColorLight5a75' });
        // A matrix larger than the models on it is fine.
        expect(reconcilePanelMatrices([tuneTo], [{ ...colorLight, channels: 24576 }])[0].drift).toBe('ok');
    });

    it('reports a matrix the controller does not have, or has disabled', () => {
        expect(reconcilePanelMatrices([tuneTo], [])[0]).toMatchObject({
            drift: 'missing',
            notes: ['the controller has no LED panel matrix 1'],
        });
        expect(reconcilePanelMatrices([tuneTo], [{ ...colorLight, enabled: false }])[0]).toMatchObject({
            drift: 'missing',
            notes: ['disabled on the controller'],
        });
    });

    it('lists each configuration difference', () => {
        const [row] = reconcilePanelMatrices(
            [{ ...tuneTo, protocol: 'LED Panel Matrix - Hat/Cap/Cape' }],
            [{ ...colorLight, startChannel: 1, channels: 12288 }],
        );
        expect(row.drift).toBe('count');
        expect(row.notes).toEqual([
            "xLights expects LED Panel Matrix - Hat/Cap/Cape, but the controller's matrix is ColorLight5a75",
            'starts at channel 1; xLights starts it at 114586',
            'holds 12288 channels; the models on it need 18432',
        ]);
    });

    it('matches driver families', () => {
        const cape = { ...colorLight, driver: 'BBShiftPanel' };
        expect(
            reconcilePanelMatrices([{ ...tuneTo, protocol: 'LED Panel Matrix - Hat/Cap/Cape' }], [cape])[0].drift,
        ).toBe('ok');
        expect(
            reconcilePanelMatrices([{ ...tuneTo, protocol: 'LED Panel Matrix - ColorLight' }], [cape])[0].drift,
        ).toBe('count');
        expect(reconcilePanelMatrices([tuneTo], [cape])[0].drift).toBe('ok');
    });

    it('flags only enabled matrices no model uses, unless idle ones are asked for', () => {
        const spare = { ...colorLight, port: 2, startChannel: 1 };
        expect(reconcilePanelMatrices([tuneTo], [colorLight, spare]).map((r) => [r.port, r.drift])).toEqual([
            [1, 'ok'],
            [2, 'unexpected'],
        ]);
        const idle = { ...spare, enabled: false };
        expect(reconcilePanelMatrices([tuneTo], [colorLight, idle])).toHaveLength(1);
        const withIdle = reconcilePanelMatrices([tuneTo], [colorLight, idle], { includeIdle: true });
        expect(withIdle.map((r) => [r.port, r.drift])).toEqual([
            [1, 'ok'],
            [2, 'ok'],
        ]);
        expect(hasPortDrift(withIdle)).toBe(false);
    });
});

const hdmi: ControllerVirtualMatrixIntent = {
    port: 1,
    model: 'Tune To',
    startChannel: 114586,
    channels: 18432,
    width: 192,
    height: 32,
};
const onDevice = {
    name: 'Tune To',
    port: 1,
    enabled: true,
    startChannel: 114586,
    channels: 18432,
    width: 192,
    height: 32,
    device: 'HDMI-A-1',
};

describe('reconcileVirtualMatrices', () => {
    it('matches by model name', () => {
        expect(reconcileVirtualMatrices([hdmi], [onDevice])[0]).toMatchObject({
            name: 'Tune To',
            drift: 'ok',
            actualDevice: 'HDMI-A-1',
        });
        expect(
            reconcileVirtualMatrices([hdmi], [{ ...onDevice, name: 'Other' }]).map((r) => [r.name, r.drift]),
        ).toEqual([
            ['Tune To', 'missing'],
            ['Other', 'unexpected'],
        ]);
    });

    it('treats every model-derived setting as drift', () => {
        const [row] = reconcileVirtualMatrices(
            [hdmi],
            [{ ...onDevice, startChannel: 1, width: 32, height: 192, port: 2, device: 'HDMI-A-2' }],
        );
        expect(row.drift).toBe('count');
        expect(row.notes).toEqual([
            'start channel 1 on the controller; xLights 114586',
            'width 32 on the controller; xLights 192',
            'height 192 on the controller; xLights 32',
            'on output 2; xLights puts it on output 1',
        ]);
        expect(reconcileVirtualMatrices([hdmi], [{ ...onDevice, enabled: false }])[0].drift).toBe('missing');
    });

    it('names an unclaimed matrix by its device when it has no description', () => {
        const rows = reconcileVirtualMatrices([], [{ ...onDevice, name: undefined, enabled: false }], {
            includeIdle: true,
        });
        expect(rows).toMatchObject([{ name: 'HDMI-A-1', drift: 'ok' }]);
    });
});

describe('buildPortMap matrices', () => {
    it('lists panel and virtual matrices alongside ports, idle ones included', () => {
        const map = buildPortMap(undefined, undefined, undefined, {
            panelIntent: [tuneTo],
            panelActual: [colorLight, { ...colorLight, port: 2, enabled: false }],
            virtualIntent: [hdmi],
            virtualActual: [],
        });
        expect(map.rows).toEqual([]);
        expect(map.panels.map((p) => [p.port, p.drift, p.intendedModels])).toEqual([
            [1, 'ok', ['Tune To']],
            [2, 'ok', []],
        ]);
        expect(map.virtuals.map((v) => [v.name, v.drift])).toEqual([['Tune To', 'missing']]);
    });

    it('has no matrix rows when neither side mentions one', () => {
        const map = buildPortMap(undefined, undefined, undefined, {});
        expect(map.panels).toEqual([]);
        expect(map.virtuals).toEqual([]);
    });
});
