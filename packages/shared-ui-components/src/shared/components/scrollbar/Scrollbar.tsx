import { FC, ReactNode } from 'react';
import { Scrollbars } from 'react-custom-scrollbars-2';
import { Box } from '@mui/material';

interface ScrollbarProps {
    className?: string;
    children?: ReactNode;
}

export const Scrollbar: FC<ScrollbarProps> = ({ className, children, ...rest }) => {
    return (
        <Scrollbars
            autoHide
            renderThumbVertical={(props) => {
                return <Box className="Scrollbar" {...props} />;
            }}
            {...rest}
        >
            {children}
        </Scrollbars>
    );
};
