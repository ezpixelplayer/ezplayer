import React, { useEffect, useRef, useState } from 'react';
import { Box } from '../box/Box';

/**
 * The "Controls:" legend overlay. Shows every time the preview opens, then
 * fades out for good once the user actually uses the controls (any
 * pointer-down or wheel on the surrounding viewer). Not persisted — a fresh
 * mount of the viewer brings it back.
 */
export const ControlHints: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const boxRef = useRef<HTMLDivElement>(null);
    const [dismissed, setDismissed] = useState(false);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        if (dismissed) return undefined;
        // The hints box is pointer-events: none, so listen on the viewer root
        // it sits in — any interaction there means the user found the controls.
        const parent = boxRef.current?.parentElement;
        if (!parent) return undefined;
        const dismiss = () => setDismissed(true);
        parent.addEventListener('pointerdown', dismiss, { capture: true });
        parent.addEventListener('wheel', dismiss, { capture: true });
        return () => {
            parent.removeEventListener('pointerdown', dismiss, { capture: true });
            parent.removeEventListener('wheel', dismiss, { capture: true });
        };
    }, [dismissed]);

    // Let the fade-out finish before unmounting.
    useEffect(() => {
        if (!dismissed || gone) return undefined;
        const t = setTimeout(() => setGone(true), 600);
        return () => clearTimeout(t);
    }, [dismissed, gone]);

    if (gone) return null;

    return (
        <Box
            ref={boxRef}
            sx={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                zIndex: 1000,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                color: 'white',
                padding: '8px 12px',
                borderRadius: 1,
                fontSize: '0.75rem',
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                opacity: dismissed ? 0 : 1,
                transition: 'opacity 0.5s',
            }}
        >
            {children}
        </Box>
    );
};
