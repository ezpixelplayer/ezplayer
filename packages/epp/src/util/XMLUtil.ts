export class XMLConstants
{
    static ELEMENT_NODE = 1;
    static ATTRIBUTE_NODE = 2;
    static TEXT_NODE = 3;
    static CDATA_SECTION_NODE = 4;
    static ENTITY_REFERENCE_NODE = 5;
    static ENTITY_NODE = 6;
    static PROCESSING_INSTRUCTION_NODE = 7;
    static COMMENT_NODE = 8;
    static DOCUMENT_NODE = 9;
    static DOCUMENT_TYPE_NODE = 10;
    static DOCUMENT_FRAGMENT_NODE = 11;
    static NOTATION_NODE = 12;
}

export function getElementByTag(e: Element, t: string): Element {
    for (let ie = 0; ie < e.childNodes.length; ++ie) {
        const n = e.childNodes[ie];
        if (n.nodeType === XMLConstants.ELEMENT_NODE) {
            const ce = n as Element;
            if (ce.tagName === t) return ce;
        }
    }
    throw new Error(`Element does not contain child with tag ${t}`);
}

export function getNumAttrDef(n: Node | null | undefined, nm: string, def: number) : number
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return Number.parseFloat(v);
}

export function getIntAttrDef(n: Node | null | undefined, nm: string, def: number) : number
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return Number.parseInt(v);
}

export function getBoolAttrDef(n: Node | null | undefined, nm: string, def: boolean) : boolean
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    if (['1','t', 'T', 'y', 'Y'].includes(v[0])) return true;
    return false;
}

export function getAttrDef(n: Node | null | undefined, nm: string, def: string) : string
{
    if (!n) return def;
    const el = n as Element;
    const v = el.getAttribute(nm);
    if (!v) return def;
    return v;
}

export function newDocument(rname: string) : Document {
    return new DOMImplementation().createDocument(null, rname, null);
}
