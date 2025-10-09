import React from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import { Box } from '@mui/material';
import clsx from 'clsx';

import { InfiniteScrollListProps } from './services/infiniteScrollListInterface';

export const InfiniteScrollList = ({
    children,
    dataLength,
    hasMore,
    customHeight = '',
    loaderMessage = <></>,
    endOfListMessage = <></>,
    scrollThreshold = 0.8,
    pullDownToRefresh = false,
    pullDownToRefreshContent = <></>,
    releaseToRefreshContent = <></>,
    pullDownToRefreshThreshold = undefined,
    refreshFunction,
    hasNext,
}: InfiniteScrollListProps) => {
    return (
        <Box id="scrollableDiv">
            <InfiniteScroll
                className={clsx('commonListScroll', customHeight)}
                scrollableTarget="scrollableDiv"
                height={customHeight}
                dataLength={dataLength}
                hasMore={hasMore}
                loader={loaderMessage}
                endMessage={endOfListMessage}
                scrollThreshold={scrollThreshold}
                pullDownToRefresh={pullDownToRefresh}
                pullDownToRefreshContent={pullDownToRefreshContent}
                releaseToRefreshContent={releaseToRefreshContent}
                pullDownToRefreshThreshold={pullDownToRefreshThreshold}
                refreshFunction={refreshFunction}
                next={hasNext}
            >
                {children}
            </InfiniteScroll>
        </Box>
    );
};
