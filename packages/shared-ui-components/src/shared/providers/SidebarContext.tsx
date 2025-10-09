import { FC, useState, createContext, ReactNode } from 'react';
import { SidebarContextType } from './models/SidebarContextType';

export const SidebarContext = createContext<SidebarContextType>({} as SidebarContextType);

interface SidebarProviderProps {
    children: ReactNode;
}

export const SidebarProvider: FC<SidebarProviderProps> = ({ children }) => {
    const [sidebarToggle, setSidebarToggle] = useState(false);
    const toggleSidebar = () => {
        setSidebarToggle(!sidebarToggle);
    };
    const closeSidebar = () => {
        setSidebarToggle(false);
    };

    return (
        <SidebarContext.Provider value={{ sidebarToggle, toggleSidebar, closeSidebar }}>
            {children}
        </SidebarContext.Provider>
    );
};
