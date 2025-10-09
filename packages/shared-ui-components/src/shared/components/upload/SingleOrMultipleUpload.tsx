import React, { useEffect, useState } from 'react';
import { FileRejection, useDropzone } from 'react-dropzone';
import { ToastContainer } from 'react-toastify';
import { Box } from '@mui/material';

import { SharedConstants } from '../../..';
import { SingleOrMultipleUploadProps } from './services/singleOrMultipleUploadInterface';
import { ToastMsgs } from '../toaster/Toast';

export const SingleOrMultipleUpload = ({
    children,
    acceptedFileFormat,
    uploadedFiles,
    maxFileSize,
    maxFilesToUpload = 10,
    isMultiple = false,
    setSingleData,
    setMultipleData,
}: SingleOrMultipleUploadProps) => {
    // State Variables
    const [files, setFiles] = useState([] as any[]);
    const [newFiles, setNewFiles] = useState([] as any[]);

    // Use Effects
    useEffect(() => {
        if (files?.length > 0) {
            if (!isMultiple && files[0]?.file && setSingleData) {
                setSingleData(files[0]?.file);
            }
        }
    }, [files]);
    useEffect(() => {
        if (newFiles?.length > 0 && isMultiple && setMultipleData) {
            setMultipleData(newFiles, uploadedFiles || []);
        }
    }, [newFiles]);

    // react dropzone
    const { getRootProps, getInputProps } = useDropzone({
        multiple: isMultiple,
        maxSize: maxFileSize,
        accept: acceptedFileFormat
            ? acceptedFileFormat.reduce<Record<string, string[]>>((acc, format) => {
                  acc[format] = [];
                  return acc;
              }, {})
            : undefined,
        onDropRejected: (rejections: FileRejection[]) => {
            if (!acceptedFileFormat.includes(rejections[0]?.file?.type)) {
                return ToastMsgs.showErrorMessage('Please upload a file with a valid format', {
                    theme: 'colored',
                    position: 'bottom-center',
                    autoClose: 5000,
                });
            } else {
                return ToastMsgs.showErrorMessage(
                    `File(s) size should be less than  ${maxFileSize / SharedConstants.MEGABYTE_CONVERTER} MB`,
                    {
                        theme: 'colored',
                        position: 'bottom-center',
                        autoClose: 5000,
                    },
                );
            }
        },
        onDropAccepted: (acceptedFiles) => {
            if (acceptedFiles?.length > 0) {
                if (!isMultiple) {
                    singleFileAccept(acceptedFiles[0]);
                } else {
                    multpileFileAccept(acceptedFiles);
                }
            } else {
                ToastMsgs.showErrorMessage('Please upload a file with a valid format', {
                    theme: 'colored',
                    position: 'bottom-center',
                    autoClose: 5000,
                });
            }
        },
    });

    const singleFileAccept = (acceptedFile: any) => {
        const newFile = new File([acceptedFile], acceptedFile?.name, {
            type: acceptedFile?.type?.includes('video') ? 'video/mp4' : acceptedFile?.type,
        });
        const fileData = Object.assign(newFile, {
            preview: URL.createObjectURL(newFile),
        });
        const payload = {
            file: newFile,
            ...fileData,
        };
        setFiles([payload]);
    };

    const multpileFileAccept = (acceptedFiles: any[]) => {
        const filesList: any[] = [];
        const oldFiles = uploadedFiles || [];
        acceptedFiles?.forEach((file) => {
            const fileData = Object.assign(file, {
                preview: URL.createObjectURL(file),
            });
            filesList.push(fileData);
        });
        const combineFiles = [...filesList, ...oldFiles];
        if (combineFiles?.length > maxFilesToUpload) {
            ToastMsgs.showErrorMessage(`File upload limit reached. You can upload upto ${maxFilesToUpload} files`, {
                theme: 'colored',
                position: 'bottom-center',
                autoClose: 5000,
            });
        } else {
            setFiles(combineFiles);
            setNewFiles(filesList);
        }
    };

    // HTML
    return (
        <>
            <input {...getInputProps()} />
            <Box {...getRootProps({ className: 'dropzone' })}>{children}</Box>
            <ToastContainer />
        </>
    );
};
