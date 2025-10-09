import { Avatar as MuiAvatar, AvatarProps as MuiAvatarProps } from '@mui/material';

export const Avatar = ({ ...props }: MuiAvatarProps) => {
    return (
        <>
            <MuiAvatar {...props} />
        </>
    );
};
