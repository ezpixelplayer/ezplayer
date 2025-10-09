export type FilePreviewType = {
    id?: string;
    file?: any;
    name: string;
    size: number;
    type: string;
    preview: string;
};

export interface SingleOrMultipleUploadProps {
    children: React.ReactNode;
    acceptedFileFormat: string[];
    uploadedFiles: any[];
    maxFileSize: number;
    maxFilesToUpload?: number;
    isMultiple?: boolean;
    setSingleData?: (data: File) => void;
    setMultipleData?: (file: FilePreviewType[], oldFiles: FilePreviewType[]) => void;
}
