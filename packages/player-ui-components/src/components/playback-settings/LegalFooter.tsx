import React, { useMemo, useState } from 'react';
import { Button } from '@mui/material';
import { Info } from '@mui/icons-material';
import { createSelector } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';

import { Box } from '../box/Box';
import { RootState } from '../../store/Store';

import { AboutDialog } from './AboutDialog';
import { LicenseDialog, LicenseEntry } from './LicenseDialog';
import { TermsDialog } from './TermsDialog';
import Licenses from '../../constants/licenses.json';
import { useUiVersion } from '../../util/UiVersionProvider';

const selectAuth = (s: RootState) => s.auth;
const selectCloudStatus = (s: RootState) => s.cloudStatus;
const selectVersionInfo = createSelector([selectAuth, selectCloudStatus], (auth, status) => ({
    playerVersion: auth.playerVersion,
    cloudVersion: status?.cloudVersion ?? 'unknown',
}));

/** Fixed footer bar with About / License / Terms buttons, each opening the
 *  corresponding self-contained dialog. Shared by SettingsDrawer and Home. */
export const LegalFooter: React.FC = () => {
    const [aboutOpen, setAboutOpen] = useState(false);
    const [licenseOpen, setLicenseOpen] = useState(false);
    const [termsOpen, setTermsOpen] = useState(false);

    const versionInfo = useSelector(selectVersionInfo);
    const uiVersion = useUiVersion();
    const licenseEntries: LicenseEntry[] = useMemo(() => Licenses, []);

    return (
        <Box
            sx={{
                flexShrink: 0,
                padding: 2,
                borderTop: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 1,
            }}
        >
            <Button
                variant="outlined"
                startIcon={<Info />}
                onClick={() => setAboutOpen(true)}
                size="small"
                sx={{ textTransform: 'none' }}
            >
                About EZPlayer
            </Button>
            <Button
                variant="outlined"
                startIcon={<Info />}
                onClick={() => setLicenseOpen(true)}
                size="small"
                sx={{ textTransform: 'none' }}
            >
                License
            </Button>
            <Button
                variant="outlined"
                startIcon={<Info />}
                onClick={() => setTermsOpen(true)}
                size="small"
                sx={{ textTransform: 'none' }}
            >
                Terms
            </Button>

            <AboutDialog
                open={aboutOpen}
                onClose={() => setAboutOpen(false)}
                playerVersion={versionInfo.playerVersion}
                cloudVersion={versionInfo.cloudVersion}
                uiVersion={uiVersion}
            />
            <LicenseDialog open={licenseOpen} onClose={() => setLicenseOpen(false)} licenses={licenseEntries} />
            <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
        </Box>
    );
};

export default LegalFooter;
