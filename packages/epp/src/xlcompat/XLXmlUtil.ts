import * as path from 'path';
import { loadXmlFile } from '../util/FileUtil';
import { ExplicitControllerDesc } from './XLControllerDesc';
import {
    getControllersAndModelChannels,
    type ModelParseOptions,
    type XlControllerActiveState,
    type XlControllerType,
} from 'xllayoutcalcs';

export class ModelRec {
    name: string;
    startch: number;
    nch: number;
    empty: boolean;
    typ: string;
    crc: number;
    simple: boolean;
    r: number; // Ch offset int to cover color order
    g: number;
    b: number;
    gamma: number;
    brightness: number;

    constructor(name: string, mtype: string, startch: number, nch: number) {
        this.name = name;
        this.startch = startch;
        this.nch = nch;
        this.empty = true; // Assume model is empty initially
        this.typ = mtype;
        this.crc = 0; // CRC initialized to 0
        this.simple = false; // Assume model is not simple initially
        this.r = 0; // Red channel offset
        this.g = 1; // Green channel offset
        this.b = 2; // Blue channel offset
        this.gamma = 1; // Default gamma value
        this.brightness = 1; // Default brightness value
    }

    toString(): string {
        return `${this.name}:${this.startch},${this.nch}`;
    }
}

export type ActiveStateChoice = XlControllerActiveState;
export type ControllerTypeChoice = XlControllerType;

export class ControllerRec {
    // Details of controller
    id: string = '';
    name: string = '';
    address: string = '';
    description: string = '';
    desc?: ExplicitControllerDesc = undefined;
    activeState?: ActiveStateChoice;
    monitor?: boolean; // This is 0/1
    type: ControllerTypeChoice = 'Unknown';

    // Channel setup within xLights / fseq files
    startch: number = -1;
    maxch: number = -1;

    // Controller type
    vendor?: string;
    model?: string;
    variant?: string;

    // Ethernet Controller - Protocol
    protocol?: string; // Can probably skip 'Player Only'...
    // DDP Options
    keepChannelNumbers?: boolean;
    channelsPerPacket?: number;
    // E1.31 Options
    universeNumbers?: number[]; // (probably start channel #s in DDP)
    universeSizes?: number[];
}

export async function readControllersAndModels(xldir: string, options?: ModelParseOptions) {
    const xmodelsXml = await loadXmlFile(path.join(xldir, 'xlights_rgbeffects.xml'));
    const xnetworksXml = await loadXmlFile(path.join(xldir, 'xlights_networks.xml'));

    // A wrong root element means a corrupt or mis-pointed show folder; fail loudly
    // rather than proceeding with silently-empty controller/model lists.
    if (xmodelsXml.documentElement?.tagName !== 'xrgb') {
        throw new Error("Root not 'xrgb'");
    }
    if (xnetworksXml.documentElement?.tagName !== 'Networks') {
        throw new Error('Root not "Networks"');
    }

    // xllayoutcalcs handles both the x2026_2 and x2026_3 layout formats natively.
    const parsed = getControllersAndModelChannels(xmodelsXml, xnetworksXml, {
        warnUnusedAttrs: false,
        ...options,
    });

    const controllers: ControllerRec[] = [];
    const controllersByName: Map<string, number> = new Map();
    for (const c of parsed.controllers) {
        const ctrl: ControllerRec = {
            id: c.id,
            address: c.address,
            name: c.name,
            description: c.description,
            // EZPlayer-specific convention: the controller Description carries
            // an explicit controller descriptor.
            desc: new ExplicitControllerDesc(c.description),

            activeState: c.activeState,
            type: c.type,
            monitor: c.monitor,

            startch: c.startChannel,
            maxch: c.maxChannels,
            universeNumbers: c.universeNumbers,
            universeSizes: c.universeSizes,
            channelsPerPacket: c.channelsPerPacket,
            keepChannelNumbers: c.keepChannelNumbers,

            vendor: c.vendor,
            model: c.model,
            variant: c.variant,

            protocol: c.protocol,
        };
        controllers.push(ctrl);
        controllersByName.set(c.name, c.startChannel);
    }

    const models: ModelRec[] = [];
    for (const m of parsed.models) {
        const nmrec = new ModelRec(m.name, m.displayAs, m.startChannel, m.channelCount);
        nmrec.r = m.rgbOffsets.r;
        nmrec.g = m.rgbOffsets.g;
        nmrec.b = m.rgbOffsets.b;
        nmrec.simple = m.simple;
        nmrec.gamma = m.gamma;
        nmrec.brightness = m.brightness;
        models.push(nmrec);
    }
    models.sort((a, b) => {
        return a.startch - b.startch;
    });

    return {
        models,
        controllers,
        controllersByName,
    };
}
