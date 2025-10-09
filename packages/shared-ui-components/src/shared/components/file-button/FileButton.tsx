// import { Button as MuiButton } from '@mui/material';

import { CombinedProps } from './services/fileButtonInterface';

export const FILE_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'image/jpeg',
    'image/png',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/xml',
];

export const FileButton = ({
    fileType,
    // variant,
    // label,
    isMultipleFile,
    onChange,
    // ...props
}: CombinedProps) => {
    // Use the explicitly provided acceptedFileTypes, or fall back to fileType
    const acceptedTypes = fileType ? fileType.join(',') : FILE_TYPES.join(',');

    const handleChangeFile = (event: any): void => {
        // Simply pass the event directly to parent component to handle validation
        onChange(event);
    };

    return (
        <div>
            <input
                accept={acceptedTypes}
                id="button-file"
                multiple={isMultipleFile}
                type="file"
                onChange={(e) => handleChangeFile(e)}
            />
            {/* <label htmlFor="button-file">
        <MuiButton {...props} variant={variant} component="span">
          {label}
        </MuiButton>
      </label> */}
        </div>
    );
};
