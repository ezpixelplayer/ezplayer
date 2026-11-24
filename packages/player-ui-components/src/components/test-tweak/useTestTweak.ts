import { useCallback, useEffect, useRef, useState } from 'react';
import {
    emptyTestTweakDoc,
    type ActiveTest,
    type TestTweakDoc,
    type TestTweakSnapshot,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';

type Reply = ({ ok: true } & TestTweakSnapshot) | { ok: false; error: string };

/** How long edits settle before the document is written to the player. */
const SAVE_DELAY_MS = 250;
/** How often the status (running test, someone else's edits) is refreshed. */
const POLL_MS = 2000;

export interface UseTestTweak {
    /** What the player last reported; undefined until the first answer. */
    snapshot?: TestTweakSnapshot;
    /** The document as edited here; ahead of the player's copy while a save is pending. */
    doc: TestTweakDoc;
    /** Edit the document. The change shows at once and is saved shortly after. */
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    startTest: (test: ActiveTest) => Promise<void>;
    stopTest: () => Promise<void>;
    /** The show's xLights model groups, flattened to models and submodels. Asked for each time: the layout may have been reloaded. */
    loadXlGroups: () => Promise<XlModelGroup[]>;
    error?: string;
    saving: boolean;
}

/** The player's Test + Tweak state over its HTTP API. */
export function useTestTweak(baseUrl: string | undefined): UseTestTweak {
    const [snapshot, setSnapshot] = useState<TestTweakSnapshot>();
    const [doc, setDoc] = useState<TestTweakDoc>(emptyTestTweakDoc);
    const [error, setError] = useState<string>();
    const [saving, setSaving] = useState(false);
    const docRef = useRef(doc);
    const dirty = useRef(false);
    const revision = useRef(-1);
    const timer = useRef<ReturnType<typeof setTimeout>>();

    const call = useCallback(
        async (method: string, path: string, body?: unknown): Promise<Reply | undefined> => {
            if (!baseUrl) return undefined;
            try {
                const res = await fetch(`${baseUrl}/api/ezp/testtweak${path}`, {
                    method,
                    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
                    body: body === undefined ? undefined : JSON.stringify(body),
                });
                const reply = (await res.json()) as Reply;
                setError(reply.ok ? undefined : reply.error);
                return reply;
            } catch (e) {
                setError(`The player did not answer (${(e as Error).message})`);
                return undefined;
            }
        },
        [baseUrl],
    );

    /** Take the player's view; its document replaces ours only when we have nothing unsaved and it changed elsewhere. */
    const adopt = useCallback((reply: Reply | undefined, ownSave: boolean) => {
        if (!reply?.ok) return;
        setSnapshot(reply);
        if (!ownSave && !dirty.current && reply.revision !== revision.current) {
            docRef.current = reply.doc;
            setDoc(reply.doc);
        }
        if (ownSave || !dirty.current) revision.current = reply.revision;
    }, []);

    useEffect(() => {
        if (!baseUrl) return;
        let gone = false;
        const poll = async () => {
            if (dirty.current) return;
            const reply = await call('GET', '');
            if (!gone) adopt(reply, false);
        };
        void poll();
        const id = setInterval(poll, POLL_MS);
        return () => {
            gone = true;
            clearInterval(id);
        };
    }, [baseUrl, call, adopt]);

    const flush = useCallback(async () => {
        timer.current = undefined;
        const sent = docRef.current;
        setSaving(true);
        const reply = await call('PUT', '/doc', sent);
        // Edits made while the save was in flight have their own save queued.
        if (docRef.current === sent) {
            dirty.current = false;
            setSaving(false);
        }
        adopt(reply, true);
    }, [call, adopt]);

    const updateDoc = useCallback(
        (change: (doc: TestTweakDoc) => TestTweakDoc) => {
            const next = change(docRef.current);
            if (next === docRef.current) return;
            docRef.current = next;
            dirty.current = true;
            setDoc(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        },
        [flush],
    );

    // Leaving the screen with an edit still settling: write it now.
    useEffect(
        () => () => {
            if (timer.current) {
                clearTimeout(timer.current);
                void flush();
            }
        },
        [flush],
    );

    const startTest = useCallback(
        async (test: ActiveTest) => adopt(await call('POST', '/test', test), false),
        [call, adopt],
    );
    const stopTest = useCallback(async () => adopt(await call('DELETE', '/test'), false), [call, adopt]);

    const loadXlGroups = useCallback(async () => {
        const reply = await call('GET', '?xlgroups=1');
        if (!reply?.ok) throw new Error('no answer');
        return reply.xlGroups ?? [];
    }, [call]);

    return { snapshot, doc, updateDoc, startTest, stopTest, loadXlGroups, error, saving };
}

export function newId(): string {
    const c = globalThis.crypto;
    return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
