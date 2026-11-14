import { DDP_MAX_PAYLOAD, DDPSender } from '../dataplane/protocols/DDP';
import { e131Universes, E131Sender, isE131MulticastAddress } from '../dataplane/protocols/E131';
import { ARTNET_PORT, ArtNetSender } from '../dataplane/protocols/ArtNet';
import { Sender, SenderJob, SendJob } from '../dataplane/SenderJob';
import { ControllerSetup, OpenControllerReport, SenderProtocol } from '../controllers/controllertypes';

import type { ControllersAndModelChannels, ModelParseOptions } from 'xllayoutcalcs';
import type { ControllerRecordRole } from './XLControllerRecords';
import {
    canFollowShowSync,
    ControllerRec,
    controllersAndModelsFromParsed,
    isPlayerOnlyRecord,
    ModelRec,
    readControllersAndModels,
} from './XLXmlUtil';

export interface ControllerState {
    setup: ControllerSetup; // This is the name and channel map (as it pertains to xLights fseq layout)
    xlRecord?: ControllerRec; // xLights controller details
    report?: OpenControllerReport; // When opened, this is the status of last attempt
    sender?: Sender;
}

/**
 * Read the xLights XML files from a show folder and build the data-plane
 * controller states.  Thin wrapper: disk read + `controllerStatesFromRecs`.
 * Callers that already hold a parsed `ControllersAndModelChannels` should
 * use `controllersFromParsedXlights` instead to avoid a second parse.
 */
export async function readControllersFromXlights(
    showdir: string,
    options?: ModelParseOptions,
    roles?: Record<string, ControllerRecordRole>,
) {
    const { controllers: xcontrollers, models: osmodels } = await readControllersAndModels(showdir, options);
    return { controllers: controllerStatesFromRecs(applyControllerRoles(xcontrollers, roles)), models: osmodels };
}

/**
 * Build the data-plane controller states from an already-parsed
 * `ControllersAndModelChannels` document (the result of xllayoutcalcs'
 * `getControllersAndModelChannels`) — no disk access.
 */
export function controllersFromParsedXlights(
    parsed: ControllersAndModelChannels,
    roles?: Record<string, ControllerRecordRole>,
): {
    controllers: ControllerState[];
    models: ModelRec[];
} {
    const { controllers: xcontrollers, models: osmodels } = controllersAndModelsFromParsed(parsed);
    return { controllers: controllerStatesFromRecs(applyControllerRoles(xcontrollers, roles)), models: osmodels };
}

/**
 * Give each controller the part EZPlayer's own record asks of it. The record
 * outranks the layout, which has no word for "remote": the active state is
 * rewritten so the data send, the sync list and the watch list all read the
 * same answer, and the role is kept beside it for the one place they differ.
 * The parsed records are left as they were.
 */
export function applyControllerRoles(
    recs: ControllerRec[],
    roles: Record<string, ControllerRecordRole> | undefined,
): ControllerRec[] {
    if (!roles) return recs;
    return recs.map((xc) => {
        const role = roles[xc.name];
        if (!role) return xc;
        const activeState = role === 'enabled' ? 'Active' : role === 'disabled' ? 'Inactive' : 'xLights Only';
        return Object.assign(new ControllerRec(), xc, { role, activeState });
    });
}

/** The protocol a layout controller is sent with, when it is one we speak. */
function senderProtocol(p: string | undefined): SenderProtocol | undefined {
    return p === 'DDP' || p === 'E131' || p === 'ArtNet' ? p : undefined;
}

function controllerStatesFromRecs(xcontrollers: ControllerRec[]): ControllerState[] {
    const ctrls: ControllerState[] = [];

    function makeErrorState(exc: ControllerRec, sum: string, skipped: boolean) {
        return {
            setup: {
                usable: false,
                skipped,
                summary: sum,
                name: exc.name,
                address: exc.address,
                proto: senderProtocol(exc.protocol),
                startCh: exc.startch,
                nCh: exc.maxch,
            },
            xlRecord: exc,
        } satisfies ControllerState;
    }

    for (const xc of xcontrollers) {
        if (isPlayerOnlyRecord(xc)) {
            // A player/proxy, not a pixel controller: no outputs to drive, so
            // it is skipped rather than reported as a bad protocol.
            ctrls.push(
                makeErrorState(
                    xc,
                    `${xc.name} is a player: it plays its own copy of the show and is not sent pixel data`,
                    true,
                ),
            );
            continue;
        }
        if (!senderProtocol(xc.protocol)) {
            ctrls.push(makeErrorState(xc, `Unsupported controller protocol ${xc.protocol}`, false));
            continue;
        }
        if (xc.activeState !== 'Active') {
            const why =
                xc.role === 'disabled'
                    ? 'its record disables it'
                    : xc.role
                      ? `its record makes it a ${xc.role}`
                      : `it is ${xc.activeState}`;
            ctrls.push(makeErrorState(xc, `Skipped controller ${xc.name} because ${why}`, true));
            continue;
        } else if (xc.type !== 'Ethernet') {
            if (xc.type === 'Null') {
                ctrls.push(makeErrorState(xc, `Skipped null controller ${xc.name}`, true));
            } else {
                ctrls.push(makeErrorState(xc, `Unsupported controller type: ${xc.type}`, false));
            }
            continue;
        }

        const c: ControllerSetup = {
            usable: true,
            skipped: false,
            summary: `${xc.description}`,
            name: xc.name,
            startCh: xc.startch,
            address: xc.address,
            nCh: xc.maxch,
            proto: senderProtocol(xc.protocol),
        };

        const ctrl: ControllerState = {
            setup: c,
            xlRecord: xc,
        };
        ctrls.push(ctrl);
    }

    return ctrls;
}

/** A controller the show drives by sync rather than by pixel data. */
export interface SyncRemoteTarget {
    name: string;
    address: string;
    /** Set when the layout reaches this controller only through an FPP proxy.
     *  Sync goes UDP straight to the device, so a proxied remote cannot hear it. */
    proxy?: string;
}

/**
 * The show's sync remotes: the controllers the layout marks "xLights Only".
 * Their channels stay in the layout, but the player sends them no pixel data
 * (`controllerStatesFromRecs` skips them) because they play their own copy of
 * the content in step with the master's sync.
 */
export function syncRemotesFromXlights(ctrls: ControllerState[]): SyncRemoteTarget[] {
    const out: SyncRemoteTarget[] = [];
    for (const c of ctrls) {
        const xc = c.xlRecord;
        if (!xc || xc.activeState !== 'xLights Only' || xc.type !== 'Ethernet' || !xc.address) continue;
        // A player holds its own copy and runs it itself; only a remote follows.
        if (xc.role === 'player') continue;
        // A remote plays the show's channels on its own; a player/proxy entry
        // carries none and must not be sent sync. maxch is -1 when unknown,
        // so only an explicit zero rules a controller out.
        if (isPlayerOnlyRecord(xc) || xc.maxch === 0) continue;
        // A family that cannot follow our sync is given content and left to
        // play it; sending it sync it will never hear would only claim a
        // remote the show does not have.
        if (!canFollowShowSync(xc)) continue;
        out.push({ name: xc.name, address: xc.address, ...(xc.fppProxy ? { proxy: xc.fppProxy } : {}) });
    }
    return out;
}

export interface OpenControllersOptions {
    /** DDP destination port override (default 4048) — a testing/diagnostic knob. */
    ddpPort?: number;
    /**
     * Per-controller max frame rate, keyed by controller name (the EZPlayer
     * controller record's fpsOverride). Wins over the xLights description's
     * [MFT:ms] tag; a value <= 0 means "no cap".
     */
    fpsOverrides?: Record<string, number>;
    /**
     * This computer's address to send from, keyed by controller name (the
     * record's forceLocalIP). Wins over the xLights Force Local IP.
     */
    forceLocalIPs?: Record<string, string>;
}

/** Min ms between frames for a controller: record override, else the
 *  description tag, else 0 (no cap). */
function minFrameTimeFor(xc: ControllerRec, opts?: OpenControllersOptions): number {
    const fps = opts?.fpsOverrides?.[xc.name];
    if (fps !== undefined && fps > 0) return Math.round(1000 / fps);
    return xc.desc?.minFrameTime ?? 0;
}

/** The local address to send from: record override, else the xLights Force
 *  Local IP, else none (the route picks the interface). */
function forceLocalIPFor(xc: ControllerRec, opts?: OpenControllersOptions): string | undefined {
    return opts?.forceLocalIPs?.[xc.name] || xc.forceLocalIP || undefined;
}

/** Whether a connect failed at binding the local address, which means this
 *  computer does not have it (or has it no longer). */
function isBindFailure(e: unknown): boolean {
    const err = e as NodeJS.ErrnoException | undefined;
    return err?.code === 'EADDRNOTAVAIL' || /^bind\b/.test(err?.message ?? '');
}

/**
 * Connect a sender from the forced local address. When that address cannot be
 * bound, connect again from whatever interface the route picks, which is what
 * xLights does with a Force Local IP the computer does not have (it keeps the
 * setting but ignores it). Returns the notice to report when that happened.
 */
async function connectFromLocalAddress(
    sender: { localAddress?: string; client?: unknown; connect(): Promise<void> },
    forced: string | undefined,
): Promise<string | undefined> {
    sender.localAddress = forced;
    try {
        await sender.connect();
        return undefined;
    } catch (e) {
        if (!forced || !isBindFailure(e)) throw e;
    }
    sender.client = undefined;
    sender.localAddress = undefined;
    await sender.connect();
    return `Force Local IP ${forced} is not assigned to any network interface on this computer; sending from the default interface instead.`;
}

export async function openControllersForDataSend(ctrls: ControllerState[], opts?: OpenControllersOptions) {
    const job = new SendJob();
    for (const c of ctrls) {
        const jobSender = await openControllerForDataSend(c, opts);
        if (jobSender) job.senders.push(jobSender);
    }
    return job;
}

/**
 * Open one controller's data sender, setting `c.report` either way.  Returns
 * the SenderJob to add to a SendJob, or undefined when the controller is
 * skipped or could not be opened.
 *
 * Separate from the loop above so one controller can be opened on its own and
 * added to a job that is already running.
 */
export async function openControllerForDataSend(
    c: ControllerState,
    opts?: OpenControllersOptions,
): Promise<SenderJob | undefined> {
    {
        if (!c.setup.usable || !c.setup.proto || !c.xlRecord) {
            // A skipped controller's summary is its notice, not an error.
            c.report = {
                name: c.setup.name,
                status: 'skipped',
                ...(c.setup.skipped ? {} : { error: `${c.setup.summary}` }),
            };
            return undefined;
        }
        const xc = c.xlRecord;

        // xLights parity (Output::Open): show data for a controller behind an
        // FPP proxy goes to the proxy host as DDP at ABSOLUTE channel numbers
        // (the proxy bridges its input channel range onward), regardless of
        // the controller's own protocol.
        const proxied = !!xc.fppProxy;

        if (c.setup.proto === 'DDP' || proxied) {
            const dsender = new DDPSender();
            dsender.address = proxied ? xc.fppProxy! : c.setup.address;
            if (opts?.ddpPort) dsender.port = opts.ddpPort;
            dsender.pushAtEnd = false; // TODO try variety
            dsender.startChNum = proxied || xc.keepChannelNumbers ? xc.startch - 1 : 0;
            if (xc.channelsPerPacket && xc.channelsPerPacket > 0) {
                dsender.channelsPerPacket = Math.min(xc.channelsPerPacket, DDP_MAX_PAYLOAD);
            }
            dsender.minTimeBetweenFrames = minFrameTimeFor(xc, opts);
            dsender.sendBufSize = Math.max(256_000, c.setup.nCh * 2);

            let notice: string | undefined;
            try {
                notice = await connectFromLocalAddress(dsender, forceLocalIPFor(xc, opts));
            } catch (e) {
                const err = e as Error;
                c.report = {
                    name: xc.name,
                    status: 'error',
                    error: `Error opening ${xc.name}: ${err.message}`,
                };
                return undefined;
            }
            const jobSender = new SenderJob();
            jobSender.parts.push({ bufIdx: 0, bufStart: c.setup.startCh - 1, bufLen: c.setup.nCh });
            jobSender.sender = dsender;
            c.report = {
                name: xc.name,
                status: 'open',
                error: '',
                notice,
            };
            dsender.controller = c;
            c.sender = dsender;
            return jobSender;
        } else if (c.setup.proto === 'E131' || c.setup.proto === 'ArtNet') {
            // Both carry the universes the layout numbers and sizes.
            const esender = c.setup.proto === 'E131' ? new E131Sender() : new ArtNetSender();
            esender.address = c.setup.address;
            esender.sendBufSize = Math.max(256_000, c.setup.nCh * 2);
            if (esender instanceof E131Sender) {
                esender.pushAtEnd = false; // TODO try variety
                esender.multicast = isE131MulticastAddress(c.setup.address);
            }
            esender.universes = e131Universes(xc.universeNumbers, xc.universeSizes);
            esender.minTimeBetweenFrames = minFrameTimeFor(xc, opts);
            let notice: string | undefined;
            try {
                notice = await connectFromLocalAddress(esender, forceLocalIPFor(xc, opts));
                // Multicast has no destination to route by, so without a forced
                // address it leaves by whatever interface the default route uses.
                if (esender instanceof E131Sender && esender.multicast && !forceLocalIPFor(xc, opts)) {
                    notice =
                        "E1.31 multicast leaves by this computer's default network interface; " +
                        'set Force Local IP (in xLights or the record) to send it from another.';
                }
                if (esender instanceof ArtNetSender && esender.client?.localPort !== ARTNET_PORT) {
                    notice =
                        `Port ${ARTNET_PORT} is in use on this computer, so ArtNet leaves from port ` +
                        `${esender.client?.localPort}; a controller that insists on the source port will not listen.`;
                }
            } catch (e) {
                const err = e as Error;
                c.report = {
                    name: xc.name,
                    status: 'error',
                    error: `Error opening ${xc.name}: ${err.message}`,
                };
                return undefined;
            }
            const jobSender = new SenderJob();
            jobSender.parts.push({ bufIdx: 0, bufStart: c.setup.startCh - 1, bufLen: c.setup.nCh });
            jobSender.sender = esender;
            c.report = {
                name: xc.name,
                status: 'open',
                error: '',
                notice,
            };
            esender.controller = c;
            c.sender = esender;
            return jobSender;
        } else {
            c.report = {
                name: xc.name,
                status: 'error',
                error: `Unsupported controller protocol ${c.setup.proto}`,
            };
        }
    }
    return undefined;
}
