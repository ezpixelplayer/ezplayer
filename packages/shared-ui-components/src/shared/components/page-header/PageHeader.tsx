import { FC, useContext } from 'react';
import PropTypes from 'prop-types';
import { Typography, Box, Link, IconButton, SvgIconProps, useTheme, useMediaQuery } from '@mui/material';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import MenuTwoToneIcon from '@mui/icons-material/MenuTwoTone';
import CloseTwoToneIcon from '@mui/icons-material/CloseTwoTone';
import { SidebarContext } from '../../providers/SidebarContext';

interface PageHeaderProps {
    children?: React.ReactNode[];
    heading?: string;
    subHeading?: string;
    icon?: React.ReactElement<SvgIconProps>;
    breadcrumbs?: any[];
    value?: string;
}

export const PageHeader: FC<PageHeaderProps> = ({
    heading = '',
    subHeading = '',
    children,
    icon,
    value,
    breadcrumbs = [],
    ...rest
}) => {
    const { sidebarToggle, toggleSidebar } = useContext(SidebarContext);
    const theme = useTheme();
    const isLg = useMediaQuery(theme.breakpoints.up('lg'));
    const navigate = useNavigate();
    const { t } = useTranslation('lang');
    const handleBreadcrumbsRoute = (link: string) => {
        if (link) {
            navigate(link);
        }
    };

    return (
        <Box
            sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                minHeight: '64px',
                px: 2,
                py: 1,
            }}
            {...rest}
        >
            {/* Left side: Breadcrumbs, Heading, Subheading */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    minWidth: 0,
                    flex: 1,
                    // Add right padding to prevent text from going under the buttons
                    pr: { xs: 8, sm: 6, md: 4 }, // Responsive padding
                }}
            >
                {breadcrumbs?.map((breadcrumb) => (
                    <Link
                        underline={breadcrumb.route ? 'hover' : 'none'}
                        variant="h3"
                        component="h3"
                        sx={{ cursor: breadcrumb.route ? 'pointer' : 'default', flexShrink: 0 }}
                        color="inherit"
                        key={breadcrumb?.name}
                        onClick={() => handleBreadcrumbsRoute(breadcrumb.route)}
                    >
                        {t(breadcrumb?.name)}
                    </Link>
                ))}
                <Typography variant="h3" component="h3" noWrap sx={{ flexShrink: 0 }}>
                    {heading}
                </Typography>
                <Typography variant="subtitle2" noWrap sx={{ color: 'text.secondary', flexShrink: 0 }}>
                    {subHeading}
                </Typography>
            </Box>

            {/* Right side: Children and Sidebar Toggle - Positioned absolutely */}
            {(!isLg || (children ?? []).length > 0) && (
                <Box
                    sx={{
                        position: 'absolute',
                        right: 16,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        zIndex: 10,
                    }}
                >
                    {children?.map((item, index) => (
                        <Box
                            key={`header${index}`}
                            sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            {item}
                        </Box>
                    ))}
                    {!isLg && (
                        <IconButton
                            color="primary"
                            onClick={toggleSidebar}
                            sx={{
                                flexShrink: 0,
                            }}
                        >
                            {!sidebarToggle ? (
                                <MenuTwoToneIcon fontSize="small" />
                            ) : (
                                <CloseTwoToneIcon fontSize="small" />
                            )}
                        </IconButton>
                    )}
                </Box>
            )}
        </Box>
    );
};

PageHeader.propTypes = {
    heading: PropTypes.string,
    subHeading: PropTypes.string,
};
