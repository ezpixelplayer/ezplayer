export type AuthProviderType = {
    accessToken: string;
    roles: string[];
    login: (authToken: string) => void;
    logout: () => void;
    setRoles: () => void;
};
