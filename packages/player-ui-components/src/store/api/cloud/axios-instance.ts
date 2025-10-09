import axios from 'axios';

const Signout = () => {
    localStorage.removeItem('logged');
    localStorage.removeItem('accessToken');
};

export function createAxiosInstance(apiServerUrlBase: string) {
    const axiosInstance = axios.create({
        baseURL: apiServerUrlBase,
        headers: {
            'Content-Type': 'application/json',
        },
    });

    axiosInstance.interceptors.request.use(
        (request) => {
            const authToken = localStorage.getItem('auth_token');
            if (authToken) {
                request.headers['Authorization'] = `Bearer ${authToken}`;
            }
            return request;
        },
        (error) => {
            return Promise.reject(error);
        },
    );

    axiosInstance.interceptors.response.use(
        (response) => {
            return response;
        },
        (error) => {
            const originalRequest = error.config;

            if (error.response?.status === 401 && originalRequest?.url === `${apiServerUrlBase}getaccesstoken`) {
                Signout();
            }
            return Promise.reject(error);
        },
    );

    return axiosInstance;
}
