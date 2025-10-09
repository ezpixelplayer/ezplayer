import { DDPSender } from "../dataplane/protocols/DDP";
import { E131Sender } from "../dataplane/protocols/E131";
import { SenderJob, SendJob } from "../dataplane/SenderJob";

import {
    ControllerSetup,
    readControllersAndModels
} from "./XLXmlUtil";

export interface OpenControllerReport {
    name: string;
    status: 'open' | 'skipped' | 'error';
    error?: string;
}

export async function openControllersForDataSend(showdir: string) {
    const controllers: ControllerSetup[] = [];
    const report: OpenControllerReport[] = [];
    const {
        controllers: xcontrollers, models: osmodels, controllersByName: ctrlbyname
    } = await readControllersAndModels(showdir);

    const job = new SendJob();

    for (const xc of xcontrollers) {
        if (xc.protocol !== 'DDP' && xc.protocol !== 'E131') {
            throw new Error(`Unexpected protocol ${xc.protocol}`);
        }

        const c: ControllerSetup = {
            name: xc.name,
            startCh: xc.startch,
            address: xc.address,
            nCh: xc.maxch,
            proto: xc.protocol as 'DDP' | 'E131',
        }
        controllers.push(c);

        if (xc.activeState !== 'Active') {
            report.push({
                name: xc.name,
                status: 'skipped',
                error: `Skipped controller ${xc.name} because it is ${xc.activeState}`,
            });
            continue;
        }
        else if (xc.type !== 'Ethernet') {
            if (xc.type === 'Null') {
                report.push({
                    name: xc.name,
                    status: 'skipped',
                    error: `Skipped null controller ${xc.name}`,
                });
            }
            else {
                report.push({
                    name: xc.name,
                    status: 'error',
                    error: `Unsupported controller type: ${xc.type}`,
                });
            }
            continue;
        }
        else {
            if (c.proto === 'DDP') {
                const dsender = new DDPSender();
                dsender.address = c.address;
                dsender.pushAtEnd = false; // TODO try variety
                dsender.startChNum = xc.keepChannelNumbers ? xc.startch - 1 : 0; 
                try {
                    await dsender.connect();
                }
                catch(e) {
                    const err = e as Error;
                    report.push({
                        name: xc.name,
                        status: 'error',
                        error: `Error opening ${xc.name}: ${err.message}`,
                    });
                    continue;
                }
                const jobSender = new SenderJob();
                jobSender.parts.push({ bufIdx: 0, bufStart: c.startCh-1, bufLen: c.nCh });
                jobSender.sender = dsender;
                job.senders.push(jobSender);
                report.push({
                    name: xc.name,
                    status: 'open',
                    error: '',
                });
            } else if (c.proto === 'E131') {
                const esender = new E131Sender();
                esender.address = c.address;
                esender.pushAtEnd = false; // TODO try variety
                // TODO!  Must fill in universe and ch per packet on multiple universes!  Do not do this now.
                esender.startUniverse = xc.universeNumbers?.[0] ?? 1;
                esender.channelsPerPacket = xc.universeSizes?.[0] ?? 510;
                await esender.connect();
                const jobSender = new SenderJob();
                jobSender.parts.push({ bufIdx: 0, bufStart: c.startCh-1, bufLen: c.nCh });
                jobSender.sender = esender;
                job.senders.push(jobSender);
                report.push({
                    name: xc.name,
                    status: 'open',
                    error: '',
                })
            } else {
                report.push({
                    name: xc.name,
                    status: 'error',
                    error: `Unsupported controller protocol ${c.proto}`,
                });
            }
        }
    }

    return {
        controllers: xcontrollers,
        controllerSetups: controllers,
        report,
        models: osmodels,
        sendJob: job,
    };
}

