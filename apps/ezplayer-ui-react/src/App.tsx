import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { useRoutes } from 'react-router-dom';
import router from './router/router';
import './scss/commonStyle.scss';
import { CssBaseline } from '@mui/material';
import { StylesProvider } from '@mui/styles';
import { Provider } from 'react-redux';
import { ThemeProviderWrapper, InitialDataProvider } from '@ezplayer/player-ui-components';
import { store, storeApi } from './store/configure-store';
import { ToastContainer } from 'react-toastify';
import { WebSocketProvider } from './components/WebSocketProvider';

const App = () => {
    const content = useRoutes(router);

    return (
        <>
            <Provider store={store}>
                <WebSocketProvider>
                    <InitialDataProvider api={storeApi}>
                        <ToastContainer />
                        <StylesProvider injectFirst>
                            <ThemeProviderWrapper>
                                <LocalizationProvider dateAdapter={AdapterDayjs}>
                                    <CssBaseline />
                                    {content}
                                </LocalizationProvider>
                            </ThemeProviderWrapper>
                        </StylesProvider>
                    </InitialDataProvider>
                </WebSocketProvider>
            </Provider>
        </>
    );
};

export default App;

