import React from 'react';
import { Button, IconButton, Tooltip } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';

interface ControlButtonProps {
    icon: SvgIconComponent;
    label: string;
    onClick: () => void;
    size?: 'small' | 'medium' | 'large';
    variant?: 'contained' | 'outlined' | 'text';
    color?: 'primary' | 'secondary' | 'error' | 'warning';
    iconOnly?: boolean; // If true, only show the icon
    disabled?: boolean;
}

export const ControlButton: React.FC<ControlButtonProps> = ({
    icon: Icon,
    label,
    onClick,
    size = 'medium',
    variant = 'contained',
    color = 'primary',
    iconOnly = false,
    disabled = false,
}) => {
    return iconOnly ? (
        <Tooltip title={label}>
            <span>
                <IconButton onClick={onClick} size={size} color={color} disabled={disabled}>
                    <Icon />
                </IconButton>
            </span>
        </Tooltip>
    ) : (
        <Button onClick={onClick} variant={variant} size={size} color={color} startIcon={<Icon />} disabled={disabled}>
            {label}
        </Button>
    );
};
