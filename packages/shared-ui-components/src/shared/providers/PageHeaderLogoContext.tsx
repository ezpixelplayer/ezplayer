import { FC, createContext, ReactNode } from 'react';

export const PageHeaderLogoContext = createContext<ReactNode>(null);

interface PageHeaderLogoProviderProps {
    logo: ReactNode;
    children: ReactNode;
}

export const PageHeaderLogoProvider: FC<PageHeaderLogoProviderProps> = ({ logo, children }) => {
    return <PageHeaderLogoContext.Provider value={logo}>{children}</PageHeaderLogoContext.Provider>;
};
