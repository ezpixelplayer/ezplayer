export interface InfiniteScrollListProps {
    children: React.ReactNode;
    dataLength: number;
    hasMore: boolean;
    customHeight?: string;
    loaderMessage?: React.ReactNode;
    endOfListMessage?: React.ReactNode;
    scrollThreshold?: number | string;
    pullDownToRefresh?: boolean;
    pullDownToRefreshContent?: React.ReactNode;
    releaseToRefreshContent?: React.ReactNode;
    pullDownToRefreshThreshold?: number;
    refreshFunction?: () => void;
    hasNext: () => void;
}
