import { DDPSender } from "../dataplane/protocols/DDP";
import { E131Sender } from "../dataplane/protocols/E131";
import { Sender, SenderJob, SendJob } from "../dataplane/SenderJob";
import {
    ControllerSetup,
    OpenControllerReport,
} from "../controllers/controllertypes";

import { ControllerRec, readControllersAndModels } from "./XLXmlUtil";

export interface ControllerState {
    setup: ControllerSetup; // This is the name and channel map (as it pertains to xLights fseq layout)
    xlRecord?: ControllerRec; // xLights controller details
    report?: OpenControllerReport; // When opened, this is the status of last attempt
    sender?: Sender;
}

export async function readControllersFromXlights(showdir: string) {
    const ctrls: ControllerState[] = [];
    const {
        controllers: xcontrollers, models: osmodels
    } = await readControllersAndModels(showdir);

    function makeErrorState(exc: ControllerRec, sum: string, skipped: boolean) {
        return (
            {
                setup: {
                    usable: false,
                    skipped,
                    summary: sum,
                    name: exc.name,
                    address: exc.address,
                    proto: (exc.protocol === 'DDP' || exc.protocol === 'E131') ? exc.protocol : undefined,
                    startCh: exc.startch,
                    nCh: exc.maxch,
                },
                xlRecord: exc,
            } satisfies ControllerState
        );
    }
    
    for (const xc of xcontrollers) {
        if (xc.protocol !== 'DDP' && xc.protocol !== 'E131') {
            ctrls.push(makeErrorState(xc, `Unsupported controller protocol ${xc.protocol}`, false));
            continue;
        }
        if (xc.activeState !== 'Active') {
            ctrls.push(makeErrorState(xc, `Skipped controller ${xc.name} because it is ${xc.activeState}`, true));
            continue;
        }
        else if (xc.type !== 'Ethernet') {
            if (xc.type === 'Null') {
                ctrls.push(makeErrorState(xc, `Skipped null controller ${xc.name}`, true));
            }
            else {
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
            proto: xc.protocol as 'DDP' | 'E131',
        }

        const ctrl: ControllerState = {
            setup: c,
            xlRecord: xc,
        }
        ctrls.push(ctrl);
    }

    return {controllers: ctrls, models: osmodels};
}

export async function openControllersForDataSend(ctrls: ControllerState[]) {
    const job = new SendJob();
    for (const c of ctrls) {
        if (!c.setup.usable || !c.setup.proto || !c.xlRecord) {
            c.report = {
                name: c.setup.name,
                status: 'skipped',
                error: `${c.setup.summary}`
            }
            continue;
        }
        const xc = c.xlRecord;

        if (c.setup.proto === 'DDP') {
            const dsender = new DDPSender();
            dsender.address = c.setup.address;
            dsender.pushAtEnd = false; // TODO try variety
            dsender.startChNum = xc.keepChannelNumbers ? xc.startch - 1 : 0; 
            dsender.minTimeBetweenFrames = xc.desc?.minFrameTime ?? 0;
            dsender.sendBufSize = Math.max(256_000, c.setup.nCh * 2);

            try {
                await dsender.connect();
            }
            catch(e) {
                const err = e as Error;
                c.report = {
                    name: xc.name,
                    status: 'error',
                    error: `Error opening ${xc.name}: ${err.message}`,
                };
                continue;
            }
            const jobSender = new SenderJob();
            jobSender.parts.push({ bufIdx: 0, bufStart: c.setup.startCh-1, bufLen: c.setup.nCh });
            jobSender.sender = dsender;
            job.senders.push(jobSender);
            c.report = {
                name: xc.name,
                status: 'open',
                error: '',
            };
            dsender.controller = c;
            c.sender = dsender;
        } else if (c.setup.proto === 'E131') {
            const esender = new E131Sender();
            esender.address = c.setup.address;
            esender.sendBufSize = Math.max(256_000, c.setup.nCh * 2);
            esender.pushAtEnd = false; // TODO try variety
            // TODO!  Must fill in universe and ch per packet on multiple universes!  Do not do this now.
            esender.startUniverse = xc.universeNumbers?.[0] ?? 1;
            esender.channelsPerPacket = xc.universeSizes?.[0] ?? 510;
            esender.minTimeBetweenFrames = xc.desc?.minFrameTime ?? 0;
            await esender.connect();
            const jobSender = new SenderJob();
            jobSender.parts.push({ bufIdx: 0, bufStart: c.setup.startCh-1, bufLen: c.setup.nCh });
            jobSender.sender = esender;
            job.senders.push(jobSender);
            c.report = {
                name: xc.name,
                status: 'open',
                error: '',
            };
            esender.controller = c;
            c.sender = esender;
        } else {
            c.report = {
                name: xc.name,
                status: 'error',
                error: `Unsupported controller protocol ${c.setup.proto}`,
            };
        }
    }

    return job;
}
