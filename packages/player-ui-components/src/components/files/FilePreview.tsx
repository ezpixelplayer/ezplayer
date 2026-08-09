import { Alert, Button, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { Box } from '../box/Box';
import type { FileEntry } from '../../services/fileManagerClient';

/**
 * Preview for the handful of types where showing beats describing: images,
 * audio, and text-ish files (JSON, XML, logs). Anything else just gets its
 * details and a download button.
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']);
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac']);
const TEXT_EXTS = new Set(['json', 'xml', 'txt', 'log', 'csv', 'md', 'ini', 'cfg', 'yaml', 'yml']);

/** Text previews are read into the DOM, so cap what we'll render. */
const MAX_TEXT_BYTES = 512 * 1024;
/** Images and audio become blob URLs; still worth a ceiling. */
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

export type PreviewKind = 'image' | 'audio' | 'text' | 'none';

export function previewKindFor(entry: FileEntry): PreviewKind {
    if (entry.kind === 'directory') return 'none';
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (IMAGE_EXTS.has(ext)) return entry.sizeBytes <= MAX_MEDIA_BYTES ? 'image' : 'none';
    if (AUDIO_EXTS.has(ext)) return entry.sizeBytes <= MAX_MEDIA_BYTES ? 'audio' : 'none';
    if (TEXT_EXTS.has(ext)) return entry.sizeBytes <= MAX_TEXT_BYTES ? 'text' : 'none';
    return 'none';
}

export interface FilePreviewProps {
    entry: FileEntry;
    kind: PreviewKind;
    /** Fetches the bytes; the dialog owns the connection. */
    fetchBlob: (path: string) => Promise<Blob>;
}

export const FilePreview: React.FC<FilePreviewProps> = ({ entry, kind, fetchBlob }) => {
    const [state, setState] = useState<{ loading: boolean; error?: string; url?: string; text?: string }>({
        loading: false,
    });

    useEffect(() => {
        if (kind === 'none') {
            setState({ loading: false });
            return;
        }
        let cancelled = false;
        let objectUrl: string | undefined;
        setState({ loading: true });

        fetchBlob(entry.path)
            .then(async (blob) => {
                if (cancelled) return;
                if (kind === 'text') {
                    const text = await blob.text();
                    if (cancelled) return;
                    setState({ loading: false, text: formatIfJson(entry.name, text) });
                    return;
                }
                objectUrl = URL.createObjectURL(blob);
                setState({ loading: false, url: objectUrl });
            })
            .catch((e: Error) => {
                if (!cancelled) setState({ loading: false, error: e.message });
            });

        return () => {
            cancelled = true;
            // Revoking on unmount is what keeps a long browsing session from
            // holding every previewed file in memory.
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [entry.path, entry.name, kind, fetchBlob]);

    if (kind === 'none') {
        return (
            <Typography variant="body2" color="text.secondary">
                No preview for this file type.
            </Typography>
        );
    }
    if (state.loading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Loading preview…</Typography>
            </Box>
        );
    }
    if (state.error) return <Alert severity="warning">{state.error}</Alert>;

    if (kind === 'image' && state.url) {
        return (
            <img
                src={state.url}
                alt={entry.name}
                style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 4 }}
            />
        );
    }
    if (kind === 'audio' && state.url) {
        return <audio src={state.url} controls style={{ width: '100%' }} />;
    }
    if (kind === 'text' && state.text !== undefined) {
        return (
            <pre
                style={{
                    margin: 0,
                    padding: 8,
                    maxHeight: 260,
                    overflow: 'auto',
                    fontSize: 12,
                    fontFamily: 'Consolas, "Courier New", monospace',
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {state.text}
            </pre>
        );
    }
    return null;
};

/** Pretty-print JSON so a minified config is actually readable. */
function formatIfJson(name: string, text: string): string {
    if (!name.toLowerCase().endsWith('.json')) return text;
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

export const DownloadButton: React.FC<{ onClick: () => void; busy: boolean }> = ({ onClick, busy }) => (
    <Button size="small" onClick={onClick} disabled={busy}>
        {busy ? 'Downloading…' : 'Download'}
    </Button>
);
