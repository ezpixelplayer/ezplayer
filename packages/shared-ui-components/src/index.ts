export { Autocomplete } from './shared/components/autocomplete/Autocomplete';
export { Button } from './shared/components/button/Button';
export { Card } from './shared/components/card/Card';
export { FileButton } from './shared/components/file-button/FileButton';
export { SimpleDialog } from './shared/components/modals/SimpleDialog';
export { PageHeader } from './shared/components/page-header/PageHeader';
export { Scrollbar } from './shared/components/scrollbar/Scrollbar';
export { Select } from './shared/components/select/Select';
export { SidebarMenus } from './shared/components/sidebar-menu-structure/SidebarMenus';
export { SuspenseLoader } from './shared/components/suspenseloader/SuspenseLoader';
export { Tables } from './shared/components/table/Tables';
export { TextField } from './shared/components/text-field/TextField';
export { ToastMsgs } from './shared/components/toaster/Toast';
export { Typography } from './shared/components/typography/Typography';

export { SidebarContext, SidebarProvider } from './shared/providers/SidebarContext';

export { themeCreator } from './shared/theme/base';
import { ExtendedTheme, ExtendedThemeOptions } from './shared/theme/base';
export type { ExtendedTheme, ExtendedThemeOptions };
export { NebulaFighterTheme } from './shared/theme/schemes/NebulaFighterTheme';
export { PureLightTheme } from './shared/theme/schemes/PureLightTheme';
export { IndexnineTheme } from './shared/theme/schemes/IndexnineTheme';

export {
    titleCase,
    formatDate,
    formatDateToUtc,
    getTimeStamp,
    getInitials,
    removeUnderscore,
    convertBytesToKb,
    getDate,
    hexToRgbA,
    convertDateToMilliseconds,
} from './shared/utils/utils';

export * from './shared/utils/utils';
export * from './shared/utils/dateUtils';
export { isElectron } from './shared/utils/isElectronUtils';
export { deepEqual } from './shared/utils/deep-equal';
