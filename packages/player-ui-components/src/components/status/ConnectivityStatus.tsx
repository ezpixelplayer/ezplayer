import { ToastMsgs } from '@ezplayer/shared-ui-components';
import CloudIcon from '@mui/icons-material/Cloud';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import DownloadIcon from '@mui/icons-material/Download';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import ForwardIcon from '@mui/icons-material/Forward';
import PersonIcon from '@mui/icons-material/Person';
import { Tooltip } from '@mui/material';
import { Box } from '../box/Box';
import { ThunkDispatch } from '@reduxjs/toolkit';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { DataStorageAPI } from '../../store/api/DataStorageAPI';
import { postRegisterPlayer } from '../../store/slices/AuthStore';
import { RootState } from '../../store/Store';

export const ConnectivityStatus: React.FC = () => {
    // Get connectivity status from Redux store
    const auth = useSelector((state: RootState) => state.auth);
    const { cloudIsReachable, cloudUserToken, playerIdToken, playerIdIsRegistered } = auth;
    const dispatch = useDispatch<ThunkDispatch<RootState, DataStorageAPI, any>>();
    const navigate = useNavigate();

    // Handle player registration when PersonIcon is clicked
    const handleRegisterPlayer = async () => {
        if (cloudUserToken && playerIdToken && !playerIdIsRegistered) {
            try {
                await dispatch(postRegisterPlayer({ playerId: playerIdToken })).unwrap();

                ToastMsgs.showSuccessMessage('Player ID registered successfully', {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                });
            } catch (error) {
                console.error('Error registering player:', error);
                ToastMsgs.showErrorMessage('Failed to register player ID', {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                });
            }
        }
    };

    // Determine connection status and icon
    const getStatusDetails = () => {
        // Cloud not reachable - disconnected state
        if (!cloudIsReachable) {
            return {
                icon: <CloudOffIcon sx={{ color: 'error.main' }} />,
                tooltip: 'Not connected to cloud',
                clickable: false,
            };
        }

        // Cloud reachable with registered player ID
        if (playerIdToken && playerIdIsRegistered) {
            return {
                icon: <CloudDoneIcon sx={{ color: 'success.main' }} />,
                tooltip: 'Connected to cloud with registered player ID',
                clickable: false,
            };
        }

        // Cloud reachable with user login but player not registered
        if (cloudUserToken && !playerIdIsRegistered) {
            return {
                icon: <PersonIcon sx={{ color: 'warning.main' }} />,
                tooltip: 'Logged in but player not registered. Click to register player.',
                clickable: true,
                onClick: handleRegisterPlayer,
            };
        }

        // Cloud reachable with user login
        if (cloudUserToken) {
            return {
                icon: <PersonIcon sx={{ color: 'warning.main' }} />,
                tooltip: 'Connected to cloud with user login',
                clickable: false,
            };
        }

        // Cloud reachable but player not registered
        return {
            icon: <CloudIcon sx={{ color: 'warning.main' }} />,
            tooltip: 'Connected to cloud but player not registered. Click to go to general settings.',
            clickable: true,
            onClick: () => navigate('/generalsettings'),
        };
    };

    const { icon, tooltip, clickable, onClick } = getStatusDetails();

    const handleClick = () => {
        if (clickable && onClick) {
            onClick();
        } else if (clickable) {
            navigate('/generalsettings');
        }
    };

    return (
        <Box
            sx={{
                ml: 2,
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                whiteSpace: 'nowrap',
            }}
        >
            <ForwardIcon />
            <ElectricBoltIcon />
            <DownloadIcon />
            <Tooltip title={tooltip}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: clickable ? 'pointer' : 'default',
                    }}
                    onClick={handleClick}
                >
                    {icon}
                </Box>
            </Tooltip>
        </Box>
    );
};

export default ConnectivityStatus;
