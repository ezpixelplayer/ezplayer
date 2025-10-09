import { toast, ToastOptions } from 'react-toastify';
export const ToastMsgs = {
    showSuccessMessage: (message: string, options: ToastOptions) => {
        toast.success(message, options);
    },

    requestPopupMessage: (message: string, options: ToastOptions) => {
        toast.success(message, options);
    },

    showWarningMessage: (message: string, options: ToastOptions) => {
        toast.warn(message, options);
    },

    showErrorMessage: (message: string, options: ToastOptions) => {
        toast.error(message, options);
    },
};
export default ToastMsgs;
