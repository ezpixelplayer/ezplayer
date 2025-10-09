export function deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) {
        return true;
    }

    if (obj1 && typeof obj1 === 'object' && obj2 && typeof obj2 === 'object') {
        if (Object.keys(obj1).length !== Object.keys(obj2).length) {
            return false;
        }

        for (const key in obj1) {
            if (Object.prototype.hasOwnProperty.call(obj1, key)) {
                if (!Object.prototype.hasOwnProperty.call(obj2, key)) {
                    return false;
                }
                if (!deepEqual(obj1[key], obj2[key])) {
                    return false;
                }
            }
        }

        return true;
    }

    return false;
}
