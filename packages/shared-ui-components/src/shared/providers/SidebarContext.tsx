import { FC, useState, createContext, ReactNode } from 'react';
import { SidebarContextType } from './models/SidebarContextType';

export const SidebarContext = createContext<SidebarContextType>({} as SidebarContextType);

interface SidebarProviderProps {
    children: ReactNode;
}

export const SidebarProvider: FC<SidebarProviderProps> = ({ children }) => {
    const [sidebarToggle, setSidebarToggle] = useState(false);
    const toggleSidebar = () => {
        setSidebarToggle((prev) => {
            if (!prev) {
                const activeElement = document.activeElement as HTMLElement | null;
                activeElement?.blur?.();
            }
            return !prev;
        });
    };
    const closeSidebar = () => {
        const activeElement = document.activeElement as HTMLElement | null;
        activeElement?.blur?.();
        setSidebarToggle(false);
    };

    return (
        <SidebarContext.Provider value={{ sidebarToggle, toggleSidebar, closeSidebar }}>
            {children}
        </SidebarContext.Provider>
    );
};
