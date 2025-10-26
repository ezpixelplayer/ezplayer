
export interface OpenControllerReport {
    name: string;
    status: 'open' | 'skipped' | 'error';
    error?: string;
}
export interface ControllerSetup {
    usable: boolean;
    summary: string;
    name: string;
    address: string;
    startCh: number;
    nCh: number;
    proto: 'DDP' | 'E131' | undefined;
}

