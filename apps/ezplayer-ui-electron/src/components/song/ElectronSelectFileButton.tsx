import { Button } from '@mui/material';
import type { EZPElectronAPI, FileSelectOptions } from '@ezplayer/ezplayer-core';

/*
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
  'text/xml'
];

function mimeTypesToExtensions(mimeTypes: string[]): string[] {
  // This list can be expanded for better accuracy
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'video/mp4': 'mp4',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/xml': 'xml',
  };
  return mimeTypes.map(type => map[type]).filter(Boolean);
}
*/

// Extend Window interface to include electronAPI
declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}
type MockFile = {
    path: string;
};

type MockEvent = {
    target: {
        files: MockFile[];
    };
};

export interface ElectronFileButtonProps {
    fileType: { name: string; extensions: string[] };
    onChange: (e: MockEvent) => void;
    isMultipleFile: boolean;
}

export function ElectronFileButton({ fileType, onChange, isMultipleFile }: ElectronFileButtonProps) {
    //const extensions = mimeTypesToExtensions(fileType ?? FILE_TYPES);

    const options: FileSelectOptions = {
        types: [
            {
                name: fileType.name,
                extensions: fileType.extensions,
            },
        ],
        multi: isMultipleFile,
    };

    const handleClick = async () => {
        try {
            const filePaths = (await window?.electronAPI?.selectFiles(options)) ?? [];
            // Mock a FileList-like event for consistency with previous behavior
            const mockEvent = {
                target: {
                    files: filePaths.map((path) => ({ path })),
                },
            };
            onChange(mockEvent);
        } catch (error) {
            console.error('Error selecting file:', error);
        }
    };

    return (
        <Button variant="contained" onClick={handleClick}>
            Select File
        </Button>
    );
}
