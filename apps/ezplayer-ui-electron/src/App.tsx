import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers';
import React from 'react';
import { useRoutes } from 'react-router-dom';
import router from './router/router';
import './scss/commonStyle.scss';
import { CssBaseline } from '@mui/material';
import { StylesProvider } from '@mui/styles';
import { Provider } from 'react-redux';
import { ThemeProviderWrapper, InitialDataProvider } from '@ezplayer/player-ui-components';
import { store, storeApi } from './store/configure-store';
import { ToastContainer } from 'react-toastify';
import { MenuNavigationListener } from './components/MenuNavigationListener';

const App = () => {
    const content = useRoutes(router);

    return (
        <>
            <Provider store={store}>
                <InitialDataProvider api={storeApi}>
                    <ToastContainer />

                    <StylesProvider injectFirst>
                        <ThemeProviderWrapper>
                            <LocalizationProvider dateAdapter={AdapterDayjs}>
                                <CssBaseline />
                                <MenuNavigationListener />
                                {content}
                            </LocalizationProvider>
                        </ThemeProviderWrapper>
                    </StylesProvider>
                </InitialDataProvider>
            </Provider>
        </>
    );
};
export default App;
