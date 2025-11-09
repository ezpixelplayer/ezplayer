import * as React from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { makeStyles } from '@mui/styles';
import { alpha, useTheme } from '@mui/material';

const useStyles = makeStyles({
    datatable: {
        '&.MuiDataGrid-root .MuiDataGrid-cell:focus-within': {
            outline: 'none !important',
        },
        '&.MuiDataGrid-root .MuiDataGrid-columnHeaderTitle': {
            fontWeight: 'bold',
        },
    },
});

export const Tables = (props: any) => {
    const { rows, columns, checkboxSelection = true, onRowDoubleClick } = props;
    const classes = useStyles();
    const theme = useTheme();
    return (
        <div className="tablestyle">
            <DataGrid
                rows={rows}
                columns={columns}
                checkboxSelection={checkboxSelection}
                disableColumnFilter={true}
                pageSizeOptions={[25, 50, 100]}
                pagination={true}
                paginationModel={{ pageSize: Array.isArray(rows) ? rows.length : 100000, page: 0 }}
                hideFooter={true}
                hideFooterSelectedRowCount={true}
                hideFooterPagination={true}
                disableColumnMenu
                autoHeight={true}
                disableRowSelectionOnClick={true}
                disableDensitySelector={true}
                classes={{ root: classes.datatable }}
                onRowDoubleClick={onRowDoubleClick}
                sx={{
                    '& .MuiDataGrid-row:hover': {
                        backgroundColor: alpha(theme.palette.action.disabledBackground, 0.05),
                    },
                }}
            />
        </div>
    );
};
