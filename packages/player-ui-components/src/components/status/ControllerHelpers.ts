import { ControllerStatus } from '@ezplayer/ezplayer-core';
import type { ChipProps } from '@mui/material';

export type ControllerStatusSeverity = 'error' | 'warning' | 'pending' | 'success' | 'disabled' | 'neutral';

export function getControllerSeverity(ctrl: ControllerStatus): ControllerStatusSeverity {
    const hasErrors = (ctrl.errors?.length ?? 0) > 0;

    if (ctrl.state === 'Inactive' || ctrl.state === 'xLights Only' || ctrl.status === 'skipped') {
        return 'disabled';
    }

    if (ctrl.status === 'error' || ctrl.connectivity === 'Down' || hasErrors) {
        return 'error';
    }

    if (ctrl.state === 'Unknown' || ctrl.status === 'unusable') {
        return 'warning';
    }

    if (ctrl.connectivity === 'Pending') {
        return 'pending';
    }

    if (ctrl.state === 'Active' || ctrl.status === 'open' || ctrl.connectivity === 'Up') {
        return 'success';
    }

    return 'neutral';
}

export function getControllersSeverity(controllers?: ControllerStatus[]): ControllerStatusSeverity {
    if (!controllers || controllers.length === 0) return 'neutral';

    const severities = controllers.map(getControllerSeverity);

    // precedence: error > (disabled) > warning > pending > success > neutral
    if (severities.includes('error')) return 'error';
    if (severities.includes('warning')) return 'warning';
    if (severities.includes('pending')) return 'pending';
    if (severities.includes('success')) return 'success';
    return 'neutral';
}

// Helper function to calculate controller statistics
export const getControllerStats = (controllers?: ControllerStatus[]) => {
    if (!controllers || controllers.length === 0) {
        return {
            total: 0,
            online: 0,
            offline: 0,
            withErrors: 0,
            errorCount: 0,
        };
    }

    const relevant = controllers.filter((c) => c.status !== 'skipped').length;
    const online = controllers.filter((c) => c.status === 'open' && c.connectivity === 'Up').length;
    const offline = controllers.filter(
        (c) => c.status === 'error' || c.status === 'unusable' || c.connectivity === 'Down',
    ).length;
    const withErrors = controllers.filter(
        (c) =>
            c.status !== 'skipped' &&
            ((c.errors && c.errors.length > 0) || c.status === 'error' || c.status === 'unusable'),
    ).length;
    const errorCount = controllers.reduce(
        (total, c) => total + (c.status === 'skipped' ? 0 : c.errors?.length || 0),
        0,
    );

    return {
        total: relevant,
        online,
        offline,
        withErrors,
        errorCount,
    };
};

export function severityToChipColor(severity: ControllerStatusSeverity): ChipProps['color'] {
    switch (severity) {
        case 'error':
            return 'error';
        case 'warning':
            return 'warning';
        case 'pending':
            return 'info';
        case 'success':
            return 'success';
        case 'disabled':
        case 'neutral':
        default:
            return 'default';
    }
}

export function severityToMainColor(severity: ControllerStatusSeverity) {
    switch (severity) {
        case 'error':
            return 'error.main';
        case 'warning':
            return 'warning.main';
        case 'pending':
            return 'info.main';
        case 'success':
            return 'success.main';
        case 'disabled':
            return 'gray.400';
        case 'neutral':
        default:
            return 'divider';
    }
}

export function severityToLightColor(severity: ControllerStatusSeverity) {
    switch (severity) {
        case 'error':
            return 'error.light';
        case 'warning':
            return 'warning.light';
        case 'pending':
            return 'info.light';
        case 'success':
            return 'success.light';
        case 'disabled':
            return 'gray.100';
        case 'neutral':
        default:
            return 'background.paper';
    }
}
