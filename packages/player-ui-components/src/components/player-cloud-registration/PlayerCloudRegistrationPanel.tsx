import React from 'react';
import { PlayerCloudWelcomePanel } from './PlayerCloudWelcomePanel';

/**
 * Cloud-screen Register dialog body. Identical layout to the first-run Welcome
 * panel (QR / URL prominent, advanced bits in an accordion) — the user already
 * clicked "Register," so this should be a low-friction path. Adds the per-folder
 * polling editor inside the Advanced accordion, which the first-run Welcome flow
 * suppresses to keep "scan and go" uncluttered.
 */
export const PlayerCloudRegistrationPanel: React.FC = () => <PlayerCloudWelcomePanel showPollingEditor />;
