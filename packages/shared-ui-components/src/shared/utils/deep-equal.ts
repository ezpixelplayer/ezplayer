export function deepEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) {
        return true;
    }

    if (obj1 && typeof obj1 === 'object' && obj2 && typeof obj2 === 'object') {
        const rec1 = obj1 as Record<string, unknown>;
        const rec2 = obj2 as Record<string, unknown>;
        if (Object.keys(rec1).length !== Object.keys(rec2).length) {
            return false;
        }

        for (const key in rec1) {
            if (Object.prototype.hasOwnProperty.call(rec1, key)) {
                if (!Object.prototype.hasOwnProperty.call(rec2, key)) {
                    return false;
                }
                if (!deepEqual(rec1[key], rec2[key])) {
                    return false;
                }
            }
        }

        return true;
    }

    return false;
}
