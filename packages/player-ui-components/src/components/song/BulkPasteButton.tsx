import React from 'react';

import { Tooltip } from '@mui/material';

import { ContentPaste } from '@mui/icons-material';

import { Button, ToastMsgs } from '@ezplayer/shared-ui-components';

import { useDispatch, useSelector } from 'react-redux';

import { AppDispatch, RootState, setSequenceTags } from '../..';

interface BulkPasteData {
    title?: string;
    artist?: string;
    vendor?: string;
    imageUrl?: string;
    tags?: string[];
}

export interface BulkPasteButtonProps {
    onTitleChange?: (title: string) => void;
    onArtistChange?: (artist: string) => void;
    onVendorChange?: (vendor: string) => void;
    onImageUrlChange?: (imageUrl: string) => void;
    onTagsChange?: (tags: string[]) => void;
}

export function BulkPasteButton({
    onTitleChange,
    onArtistChange,
    onVendorChange,
    onImageUrlChange,
    onTagsChange,
}: BulkPasteButtonProps) {
    const dispatch = useDispatch<AppDispatch>();
    const availableTags = useSelector((state: RootState) => state.sequences.tags);

    const handleBulkPaste = async () => {
        try {
            // Read from clipboard
            const clipboardText = await navigator.clipboard.readText();

            if (!clipboardText.trim()) {
                ToastMsgs.showErrorMessage('Clipboard is empty', {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                });
                return;
            }

            const parsed: BulkPasteData = JSON.parse(clipboardText);

            // Populate form fields from parsed JSON
            if (parsed.title && onTitleChange) {
                onTitleChange(parsed.title);
            }
            if (parsed.artist && onArtistChange) {
                onArtistChange(parsed.artist);
            }
            if (parsed.vendor && onVendorChange) {
                onVendorChange(parsed.vendor);
            }
            if (parsed.imageUrl && onImageUrlChange) {
                onImageUrlChange(parsed.imageUrl);
            }
            if (parsed.tags && Array.isArray(parsed.tags) && onTagsChange) {
                onTagsChange(parsed.tags);
                // Add new tags to available tags
                parsed.tags.forEach((tag) => {
                    if (tag && !availableTags.includes(tag)) {
                        dispatch(setSequenceTags([...availableTags, tag]));
                    }
                });
            }

            ToastMsgs.showSuccessMessage('Data pasted successfully', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } catch (error) {
            ToastMsgs.showErrorMessage('Invalid JSON format in clipboard. Please check your clipboard content.', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 3000,
            });
        }
    };

    return (
        <Tooltip title="Paste song details from ezrgb.com">
            <span>
                <Button
                    icon={<ContentPaste />}
                    variant="outlined"
                    size="small"
                    onClick={handleBulkPaste}
                />
            </span>
        </Tooltip>
    );
}

