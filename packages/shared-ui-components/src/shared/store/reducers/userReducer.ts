import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface TenantRoleType {
    tenantId: number;
    roles: string[];
}

export interface UserType {
    name: string;
    email: string;
    userId: number;
    tenantRoles: TenantRoleType[];
}

const initialState: UserType = {
    name: '',
    email: '',
    userId: 0,
    tenantRoles: [],
};

const userSlice = createSlice({
    name: 'user',
    initialState,
    reducers: {
        setUserDetails(state, action: PayloadAction<UserType>) {
            return { ...state, ...action.payload };
        },
        clearUserDetails(_state) {
            return initialState;
        },
    },
});

export const { setUserDetails, clearUserDetails } = userSlice.actions;
export const userReducer = userSlice.reducer;
