import * as path from 'path';
import { loadXmlFile } from '../util/FileUtil';
import { ExplicitControllerDesc } from './XLControllerDesc';
import {
    getControllersAndModelChannels,
    type ControllersAndModelChannels,
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

    // Reachability options (set only when the XML declares them)
    /** FPP proxy host this controller is reached through (`FPPProxy` attr or
     *  the networks root's `GlobalFPPProxy`).  xLights sends show data for a
     *  proxied controller to this host as DDP at absolute channel numbers. */
    fppProxy?: string;
    /** Local NIC address to bind when sending to this controller
     *  (`ForceLocalIP` attr or root `GlobalForceLocalIP`) — multi-NIC hint. */
    forceLocalIP?: string;
}

/**
 * Flatten an already-parsed `ControllersAndModelChannels` document into the
 * legacy `ControllerRec`/`ModelRec` view used by the data plane.
 *
 * This is the parse-once entry point: a caller that has already run
 * `getControllersAndModelChannels` (e.g. for controller reconciliation or
 * model coordinates) can derive the data-plane view from the same parse
 * instead of re-reading the XML files from disk.
 */
export function controllersAndModelsFromParsed(parsed: ControllersAndModelChannels) {
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

            // '' means "not set" in the XML; keep unset fields absent here.
            fppProxy: c.fppProxy || undefined,
            forceLocalIP: c.forceLocalIP || undefined,
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

/**
 * Read `xlights_rgbeffects.xml` / `xlights_networks.xml` from a show folder
 * and flatten them into the legacy `ControllerRec`/`ModelRec` view.
 *
 * Thin wrapper: parse (via xllayoutcalcs) + delegate to
 * `controllersAndModelsFromParsed`.  Callers that already hold a parsed
 * `ControllersAndModelChannels` should call that function directly instead
 * of re-reading the files.
 */
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

    return controllersAndModelsFromParsed(parsed);
}
