import { AxiosInstance, AxiosRequestConfig } from 'axios';

export interface TAxiosCustomConfig {
    variables?: string;
    setLoading?: (res: true | false) => void;
}
export interface Config extends AxiosRequestConfig {
    custom?: TAxiosCustomConfig;
}

export async function apiGet<T = unknown>(axiosInstance: AxiosInstance, resource: string, config?: AxiosRequestConfig) {
    return axiosInstance.get<T>(resource, config);
}

export async function apiPost<T = unknown>(
    axiosInstance: AxiosInstance,
    resource: string,
    data?: unknown,
    config?: AxiosRequestConfig,
) {
    return axiosInstance.post<T>(resource, data, config);
}

export async function apiPut<T = unknown>(
    axiosInstance: AxiosInstance,
    resource: string,
    data?: unknown,
    config?: AxiosRequestConfig,
) {
    return axiosInstance.put<T>(resource, data, config);
}

export async function apiDelete<T = unknown>(
    axiosInstance: AxiosInstance,
    resource: string,
    data?: unknown,
    _config?: AxiosRequestConfig,
) {
    return axiosInstance.delete<T>(resource, { data: data });
}
