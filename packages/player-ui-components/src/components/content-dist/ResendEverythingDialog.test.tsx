// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ResendEverythingDialog } from './ResendEverythingDialog';

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('confirming a forced re-send', () => {
    it('says what it will do and why the ordinary send cannot be trusted here', () => {
        render(<ResendEverythingDialog open deviceCount={4} onClose={vi.fn()} onConfirm={vi.fn()} />);
        expect(screen.getByText(/all 4 devices/)).toBeTruthy();
        expect(screen.getByText(/rearranges models inside one controller’s range/)).toBeTruthy();
    });

    it('sends only on confirmation, and closes either way', () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        render(<ResendEverythingDialog open deviceCount={1} onClose={onClose} onConfirm={onConfirm} />);

        screen.getByText('Cancel').click();
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);

        screen.getByText('Send everything').click();
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
