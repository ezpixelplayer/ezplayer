import { getBoolAttrDef, getNumAttrDef, XMLConstants } from '../util/XMLUtil';
import { loadXmlFile } from '../util/FileUtil';
import { ExplicitControllerDesc } from './XLControllerDesc';

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

export type ActiveStateChoice = 'Active' | 'Inactive' | 'xLights Only' | 'Unknown';
export type ControllerTypeChoice = 'Null' | 'Ethernet' | 'Serial' | 'Unknown';

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

export async function readControllersAndModels(xldir: string) {
    const models: ModelRec[] = [];
    const controllers: ControllerRec[] = [];
    const controllersByName: Map<string, number> = new Map();
    const xmodelsXml = await loadXmlFile(`${xldir}/xlights_rgbeffects.xml`);
    const xnetworksXml = await loadXmlFile(`${xldir}/xlights_networks.xml`);

    // Handle networks
    const xndNetworks = xnetworksXml.documentElement;
    if (!xndNetworks) {
        throw new Error('Root not "Networks"');
    }

    let startch = 1;
    for (let icn = 0; icn < xndNetworks.childNodes.length; ++icn) {
        const ncn = xndNetworks.childNodes[icn];
        if (ncn.nodeType !== XMLConstants.ELEMENT_NODE) continue;
        const cn = ncn as Element;
        if (cn.tagName !== 'Controller') continue;

        const rawstate = cn.getAttribute('ActiveState');
        const astate = ['Active', 'Inactive', 'xLights Only'].includes(rawstate ?? '') ? rawstate : 'Unknown';
        const rawctype = cn.getAttribute('Type');
        const ctype = ['Null', 'Ethernet', 'Serial'].includes(rawctype ?? '') ? rawctype : 'Unknown';

        const description = cn.getAttribute('Description') || '';

        const ctrl: ControllerRec = {
            id: cn.getAttribute('Id') || '',
            address: cn.getAttribute('IP') || '',
            name: cn.getAttribute('Name')!,
            description: description,
            desc: new ExplicitControllerDesc(description),

            activeState: astate as ActiveStateChoice,
            type: ctype as ControllerTypeChoice,
            monitor: getBoolAttrDef(cn, 'Monitor', true),

            startch,
            maxch: 0,
            universeNumbers: [],
            universeSizes: [],
            channelsPerPacket: 1440,
            keepChannelNumbers: false,

            vendor: cn.getAttribute('Vendor') || '',
            model: cn.getAttribute('Model') || '',
            variant: cn.getAttribute('Variant') || '',

            protocol: cn.getAttribute('Protocol') || '',
        };
        controllers.push(ctrl);
        controllersByName.set(cn.getAttribute('Name')!, startch);

        for (let inet = 0; inet < cn.childNodes.length; ++inet) {
            const nnet = cn.childNodes[inet];
            if (nnet.nodeType !== XMLConstants.ELEMENT_NODE) continue;
            const net = nnet as Element;
            if (net.tagName !== 'network') continue;
            const pch = getNumAttrDef(net, 'MaxChannels', 510);
            const unum = getNumAttrDef(net, 'BaudRate', 1);
            ctrl.universeNumbers?.push(unum);
            ctrl.universeSizes?.push(pch);
            startch += pch;
            ctrl.maxch += pch;
            ctrl.channelsPerPacket = getNumAttrDef(net, 'ChannelsPerPacket', 1440);
            ctrl.keepChannelNumbers = getBoolAttrDef(net, 'KeepChannelNumbers', false);
        }
    }

    const xnd = xmodelsXml.documentElement;
    if (xnd.tagName !== 'xrgb') {
        throw new Error("Root not 'xrgb'");
    }

    // Handle models

    for (let igrp = 0; igrp < xnd.childNodes.length; ++igrp) {
        const ngrp = xnd.childNodes[igrp];
        if (ngrp.nodeType !== XMLConstants.ELEMENT_NODE) continue;
        const grp = ngrp as Element;
        if (grp.tagName !== 'models') continue;

        for (let imdl = 0; imdl < grp.childNodes.length; ++imdl) {
            const nmdl = grp.childNodes[imdl];
            if (nmdl.nodeType !== XMLConstants.ELEMENT_NODE) continue;
            const mdl = nmdl as Element;
            if (mdl.tagName !== 'model') continue;

            const name = mdl.getAttribute('name')!;
            const mtyp = mdl.getAttribute('DisplayAs') ?? '';
            const chstr = mdl.getAttribute('StartChannel') ?? '';
            if (!name || !chstr) {
                // Some sort of inactive, degenerate thing
                continue;
            }
            let channel = -1;
            if (chstr[0] >= '0' && chstr[0] <= '9') {
                channel = parseInt(chstr);
            } else if (chstr[0] === '@') {
                continue;
            } else if (chstr[0] === '!') {
                // TODO Look up controller
                const [ctrlnm, offset] = chstr.slice(1).split(':');
                channel = controllersByName.get(ctrlnm)! + parseInt(offset) - 1;
            } else if (chstr[0] === '#') {
                // Huh, seems to be an IP:universe:channel or universe:channel
                //(ctrladdr,univ,ch) = chstr[1:].split(':')
                // TODO we would need to find the channel for the universe or something
                //channel = ctrlbyname[ctrladdr]
                continue;
            } else if (chstr[0] === '>') {
                // Shadow model name:channel such as ">Spinner 2:1"
                continue;
            } else {
                throw new Error(`Unknown channel string: "${chstr}" in model ${name}`);
            }

            const nmrec = new ModelRec(name, mtyp, channel, -1);

            if (mdl.hasAttribute('StringType')) {
                const strtyp = mdl.getAttribute('StringType')!;
                if (strtyp === 'RGB Nodes') {
                    nmrec.r = 0;
                    nmrec.g = 1;
                    nmrec.b = 2;
                    nmrec.simple = true;
                }
                if (strtyp === 'RBG Nodes') {
                    nmrec.r = 0;
                    nmrec.g = 2;
                    nmrec.b = 1;
                    nmrec.simple = true;
                }
                if (strtyp === 'GRB Nodes') {
                    nmrec.r = 1;
                    nmrec.g = 0;
                    nmrec.b = 2;
                    nmrec.simple = true;
                }
                if (strtyp === 'GBR Nodes') {
                    nmrec.r = 2;
                    nmrec.g = 0;
                    nmrec.b = 1;
                    nmrec.simple = true;
                }
                if (strtyp === 'BRG Nodes') {
                    nmrec.r = 1;
                    nmrec.g = 2;
                    nmrec.b = 0;
                    nmrec.simple = true;
                }
                if (strtyp === 'BGR Nodes') {
                    nmrec.r = 2;
                    nmrec.g = 1;
                    nmrec.b = 0;
                    nmrec.simple = true;
                }
            }

            for (let idc = 0; idc < mdl.childNodes.length; ++idc) {
                const ndc = mdl.childNodes[idc];
                if (ndc.nodeType !== XMLConstants.ELEMENT_NODE) continue;
                const dc = ndc as Element;
                if (dc.tagName !== 'dimmingCurve') continue;

                for (let iddc = 0; iddc < dc.childNodes.length; ++iddc) {
                    const nddc = dc.childNodes[iddc];
                    if (nddc.nodeType !== XMLConstants.ELEMENT_NODE) continue;
                    const ddc = nddc as Element;
                    if (ddc.tagName !== 'all') continue;
                    if (ddc.hasAttribute('gamma')) {
                        nmrec.gamma = parseFloat(ddc.getAttribute('gamma')!);
                    }
                    if (ddc.hasAttribute('brightness')) {
                        nmrec.brightness = Math.min(1.0, (100.0 + parseFloat(ddc.getAttribute('brightness')!)) / 100.0);
                    }
                }
            }
            models.push(nmrec);
        }
    }
    // Oh heck how to calculate channels per model
    //  Will we eventually just have to add specific logic?
    models.sort((a, b) => {
        return a.startch - b.startch;
    });

    for (let i = 0; i < models.length; ++i) {
        if (i === models.length - 1) continue;
        models[i].nch = models[i + 1].startch - models[i].startch;
    }
    const osmodels: ModelRec[] = [];
    for (const m of models) {
        osmodels.push(m);
    }

    return {
        models: osmodels,
        controllers,
        controllersByName,
    };
}
