import { ControllerStatus } from '@ezplayer/ezplayer-core';
import type { ChipProps } from '@mui/material';

export type ControllerStatusSeverity = 'error' | 'warning' | 'pending' | 'success' | 'disabled' | 'neutral';

/**
 * Whether this controller is part of this show: not Inactive, and watched.
 *
 * "Skipped" on a row means two things. An Inactive or Null controller is out
 * of the show. A player or a remote is skipped only by the data sender: it
 * plays its own copy and follows sync, and the player pings it because its
 * being down costs part of the display. Being watched separates the two.
 */
export function controllerInShow(ctrl: ControllerStatus): boolean {
    if (ctrl.state === 'Inactive') return false;
    return !!ctrl.connectivity && ctrl.connectivity !== 'N/A';
}

/** In the show, and playing from its own copy rather than being sent pixels. */
export function controllerPlaysOwnCopy(ctrl: ControllerStatus): boolean {
    return ctrl.status === 'skipped' && controllerInShow(ctrl);
}

/**
 * Up, down, or not yet known: one verdict per controller, so card counts add
 * up. The ping is the common answer, since a remote has no data sender and
 * never reports `open`; a failed sender is down whatever its ping says.
 */
export function controllerLiveness(ctrl: ControllerStatus): 'up' | 'down' | 'pending' {
    if (ctrl.connectivity === 'Down' || ctrl.status === 'error' || ctrl.status === 'unusable') return 'down';
    return ctrl.connectivity === 'Up' ? 'up' : 'pending';
}

/** The word for this controller's part, for the status chip. */
export function controllerStatusLabel(ctrl: ControllerStatus): string {
    if (!controllerInShow(ctrl)) return 'not in this show';
    if (controllerPlaysOwnCopy(ctrl)) return 'plays its own copy';
    return ctrl.status ?? 'unknown';
}

export function getControllerSeverity(ctrl: ControllerStatus): ControllerStatusSeverity {
    const hasErrors = (ctrl.errors?.length ?? 0) > 0;

    // Out of the show.
    if (!controllerInShow(ctrl)) {
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

/**
 * The counts a status card shows, taken over the controllers in this show so
 * `online + offline + pending === total`; rows not in the show are counted
 * once, in `outOfShow`.
 */
export const getControllerStats = (controllers?: ControllerStatus[]) => {
    const all = controllers ?? [];
    const inShow = all.filter(controllerInShow);
    const liveness = inShow.map(controllerLiveness);

    return {
        total: inShow.length,
        online: liveness.filter((l) => l === 'up').length,
        offline: liveness.filter((l) => l === 'down').length,
        /** Watched, with no ping round finished yet. */
        pending: liveness.filter((l) => l === 'pending').length,
        /** Of the ones in the show, how many play from their own copy. */
        playsOwnCopy: inShow.filter(controllerPlaysOwnCopy).length,
        /** Inactive, Null, or otherwise not part of this show at all. */
        outOfShow: all.length - inShow.length,
        withErrors: inShow.filter(
            (c) => (c.errors && c.errors.length > 0) || c.status === 'error' || c.status === 'unusable',
        ).length,
        errorCount: inShow.reduce((total, c) => total + (c.errors?.length || 0), 0),
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
