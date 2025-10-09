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
}

export const ControlButton: React.FC<ControlButtonProps> = ({
    icon: Icon,
    label,
    onClick,
    size = 'medium',
    variant = 'contained',
    color = 'primary',
    iconOnly = false,
}) => {
    return iconOnly ? (
        <Tooltip title={label}>
            <IconButton onClick={onClick} size={size} color={color}>
                <Icon />
            </IconButton>
        </Tooltip>
    ) : (
        <Button onClick={onClick} variant={variant} size={size} color={color} startIcon={<Icon />}>
            {label}
        </Button>
    );
};
