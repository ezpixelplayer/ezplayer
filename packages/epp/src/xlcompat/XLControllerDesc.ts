export class ExplicitControllerDesc {
    desc: string = "";
    minFrameTime: number = 0;
    tags: string[] = [];

    constructor(sval: string) {
        this.setFromString(sval);
    }

    toString(): string {
        return this.getAsString();
    }

    getAsString(): string {
        let res = "";
        // Description
        if (this.desc) res += this.desc;
        // Special tags
        if (this.minFrameTime) res += '[MFT:'+this.minFrameTime+']';
        // Things that sorta looked like tags
        for (const t of this.tags)
            res += '['+t+']';
        return res;
    }

    static parseDescription(dstr: string) {
        const tags: string[] = [];
        let curtag = "";
        let intag = false;
        let rest = "";
        for (const c of dstr) {
            if (c === '[') {
                intag = true;
            }
            else if (c === ']') {
                intag = false;
                if (curtag) {
                    tags.push(curtag);
                    curtag = "";
                }
            }
            else if (intag) {
                curtag += c;
            }
            else {
                rest += c;
            }
        }
        return {rest, tags};
    }

    setFromString(sstr: string): void {
        const {rest, tags} = ExplicitControllerDesc.parseDescription(sstr);
        this.desc = rest;

        for (const t of tags) {
            const parts = t.split(':');
            if (parts.length === 2) {
                if (parts[0] === 'MFT') this.minFrameTime = Number.parseInt(parts[1]);
                else {
                    // Unidentified KV tag
                    console.log("Unexpected tag in controller description: "+parts[0]);
                    this.tags.push(t);
                }
            }
            else {
                // Unidentified tag
                this.tags.push(t);
            }
        }
    }

    hasTags(): boolean {
        if (this.tags.length) return true;
        if (this.minFrameTime) return true;
        return false;
    }

    hasContent(): boolean {
        if (this.desc) return true;
        return this.hasTags();
    }
}
