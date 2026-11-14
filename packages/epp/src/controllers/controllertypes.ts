export interface OpenControllerReport {
    name: string;
    status: 'open' | 'skipped' | 'error';
    error?: string;
    /** Worth telling the operator about an open sender, such as a forced
     *  local address it could not use. */
    notice?: string;
}
/** The protocols the data plane can send a controller with, as xLights names them. */
export type SenderProtocol = 'DDP' | 'E131' | 'ArtNet';

export interface ControllerSetup {
    skipped: boolean;
    usable: boolean;
    summary: string;
    name: string;
    address: string;
    startCh: number;
    nCh: number;
    proto: SenderProtocol | undefined;
}
