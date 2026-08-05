import { describe, expect, test } from 'vitest';
import { isAssetPathAbsolute, resolveShowAssetPath } from './ShowAssetPath';

// The incident this guards against: a layout authored on Windows carries
// C:\...\image.jpg refs; the show folder is copied to a Linux player. POSIX
// path.isAbsolute says false for drive-letter paths, so the old resolver
// passed them through as "relative" and the server 400'd them — images
// worked on the Windows machine and silently vanished on the Pi.

const index = new Map<string, string>([
    ['snowman.jpg', 'images/snowman.jpg'],
    ['house.obj', 'meshes/house.obj'],
]);

describe('isAssetPathAbsolute', () => {
    test('detects foreign-platform absolute forms on any host', () => {
        expect(isAssetPathAbsolute('C:\\Users\\chuck\\Pictures\\snowman.jpg')).toBe(true);
        expect(isAssetPathAbsolute('C:/Users/chuck/Pictures/snowman.jpg')).toBe(true);
        expect(isAssetPathAbsolute('\\\\nas\\share\\snowman.jpg')).toBe(true);
        expect(isAssetPathAbsolute('/home/pi/show/images/snowman.jpg')).toBe(true);
    });

    test('leaves relative refs alone', () => {
        expect(isAssetPathAbsolute('images/snowman.jpg')).toBe(false);
        expect(isAssetPathAbsolute('images\\snowman.jpg')).toBe(false);
    });
});

describe('resolveShowAssetPath', () => {
    test('Windows absolute ref on a POSIX show folder rebases by basename', () => {
        // The exact Pi scenario: foreign drive-letter path, file copied into the show folder.
        expect(resolveShowAssetPath('C:\\Users\\chuck\\Pictures\\snowman.jpg', '/home/pi/show', index)).toBe(
            'images/snowman.jpg',
        );
    });

    test('Windows absolute ref gets its basename despite POSIX path.basename semantics', () => {
        // Backslash is not a separator on POSIX; the resolver must split after normalizing.
        expect(resolveShowAssetPath('C:\\Elsewhere\\house.obj', '/home/pi/show', index)).toBe('meshes/house.obj');
    });

    test('absolute ref inside the show folder is relativized (case-insensitive)', () => {
        expect(
            resolveShowAssetPath('C:\\Shows\\My Show\\images\\snowman.jpg', 'C:\\shows\\my show', new Map()),
        ).toBe('images/snowman.jpg');
        expect(resolveShowAssetPath('/home/pi/show/images/snowman.jpg', '/home/pi/show', new Map())).toBe(
            'images/snowman.jpg',
        );
    });

    test('relative refs pass through with slashes normalized, no existence check', () => {
        expect(resolveShowAssetPath('images\\snowman.jpg', '/home/pi/show', new Map())).toBe('images/snowman.jpg');
        expect(resolveShowAssetPath('images/snowman.jpg', '/home/pi/show', new Map())).toBe('images/snowman.jpg');
    });

    test('absolute ref outside the show folder with no index match is unresolved', () => {
        expect(resolveShowAssetPath('C:\\Users\\chuck\\gone.png', '/home/pi/show', index)).toBeUndefined();
        expect(resolveShowAssetPath('/etc/passwd', '/home/pi/show', index)).toBeUndefined();
    });

    test('UNC ref rebases by basename', () => {
        expect(resolveShowAssetPath('\\\\nas\\share\\snowman.jpg', '/home/pi/show', index)).toBe(
            'images/snowman.jpg',
        );
    });
});
