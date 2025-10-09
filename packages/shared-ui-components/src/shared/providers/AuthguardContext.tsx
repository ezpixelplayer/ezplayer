import { createContext, useContext, useState } from 'react';
import { AuthProviderType } from './models/AuthguardContextType';

export const useAuthProvider = () => {
    // State Values
    const [accessToken, setAccessToken] = useState(localStorage.getItem('accessToken') || '');
    const [roles, setUserRoles] = useState<string[]>(JSON.parse(localStorage.getItem('userRoles') || '[]') as string[]); // TODO:: Update user roles on change of redux value

    // Methods
    const login = (authToken: string) => {
        setAccessToken(authToken);
    };
    const logout = () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('logged');
        setAccessToken('');
    };
    const setRoles = (userRoleList: string[]) => {
        setUserRoles(userRoleList);
    };

    return {
        accessToken,
        roles,
        login,
        logout,
        setRoles,
    };
};
const defaultAuthContext = {};

const AuthContext = createContext<AuthProviderType>(defaultAuthContext as any);

export const useAuth = () => {
    return useContext(AuthContext);
};

export const AuthProvider = ({ children }: { children: JSX.Element }) => {
    const auth = useAuthProvider();
    return <AuthContext.Provider value={auth as any}>{children}</AuthContext.Provider>;
};
