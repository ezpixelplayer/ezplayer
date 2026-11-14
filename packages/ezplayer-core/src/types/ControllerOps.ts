/**
 * Shared, WebSocket-broadcast state for controller discovery, status reads, and
 * adjustments — the `controllerops` key in FullPlayerState.
 */

/** Generic detail-tree node; one generic renderer can draw any driver's detail. */
export interface ControllerDetailNode {
    label: string;
    value?: string | number | boolean;
    icon: string;
    kind?: string;
    children?: ControllerDetailNode[];
}

/** How a controller was reached (1 level max), for dedup + display. */
export type ControllerSource = { via: 'direct' } | { via: 'fpp-proxy'; proxy: string } | { via: 'ezp'; host: string };

/** A management action the driver offers — builds the per-device actions menu. */
export interface ControllerDeviceAction {
    id: string;
    label: string;
    description?: string;
    /** Interrupts/visibly affects the device — UI should confirm first. */
    dangerous?: boolean;
}

/** Last-known view of one controller. */
export interface DiscoveredController {
    /** Stable key ("<ip>|<via>[:<proxy/host>]") — also this device's key in `devices`. */
    id: string;
    ip: string;
    source: ControllerSource;
    mac?: string;
    oui?: string;
    hostname?: string;
    protocols?: string[];
    // depth >= identify
    driverType?: string;
    vendor?: string;
    model?: string;
    firmwareVersion?: string;
    // depth === full
    detail?: ControllerDetailNode[];
    /** Actual per-port config read from the device (full depth). */
    pixelPorts?: ControllerPort[];
    /** Pixel ports physically fitted, when the device says (full depth). */
    pixelPortCount?: number;
    /** Actual serial (DMX/…) port config read from the device (full depth). */
    serialPorts?: ControllerSerialPort[];
    /** Serial ports physically fitted, when the device says (full depth). */
    serialPortCount?: number;
    /** LED panel matrices read from the device (full depth); empty when read
     *  and none are configured, absent when not read. */
    panelMatrices?: ControllerPanelMatrix[];
    /** HDMI virtual matrices read from the device (full depth), same convention. */
    virtualMatrices?: ControllerVirtualMatrix[];
    /** Actual data-input config read from the device (full depth). */
    inputs?: ControllerInputInfo;
    /** Actions the driver enumerated (filled on status deep-reads). */
    actions?: ControllerDeviceAction[];
    /** Device role, e.g. an FPP's player / remote / bridge (full depth). */
    mode?: string;
    /** Set when `mode` disagrees with the role the layout asks for — the
     *  device has not been configured for this show. */
    modeDrift?: string;
    /**
     * Set on the show's player when the send list it holds -- which
     * controller is sent which channels -- differs from the layout. No
     * controller can report this; only the player holds the list.
     */
    sendListDrift?: string;
    /**
     * Channels this device outputs, as it reports them ("0-509,1024-2047",
     * 0-based with inclusive ends).  What a sequence is cut down to when the
     * device only needs its own part of the show.
     */
    channelRanges?: string;
    /** What show content this device holds, from the last distribution or check. */
    contentStatus?: ControllerContentStatus;
    error?: string;
    /**
     * Set when the device was seen before but nothing answers at its address
     * any more (a failed refresh, or a later scan of its network that did not
     * find it). The last-known detail is kept; the grid shows the record as
     * absent until it answers again.
     */
    unreachable?: boolean;
    /** ISO timestamp this controller's info was last refreshed. */
    seenAt: string;
}

export type ControllerOpKind = 'scan' | 'status' | 'action' | 'upload' | 'distribute';
/** `queued` = waiting for a free slot (the player limits how many of a kind
 *  run at once); `cancelled` = stopped on request before completion, partial
 *  results kept. */
export type ControllerOpStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
/** `auto` marks a read the player started by itself, not a user action. */
export type ControllerOpOrigin = 'lan' | 'cloud' | 'cli' | 'auto';

export interface ControllerOpProgress {
    phase: string;
    scanned: number;
    total: number;
    alive: number;
    identified: number;
}

/** One operation we are running (or recently ran) against controllers. */
export interface ControllerOp {
    id: string;
    kind: ControllerOpKind;
    /** Networks (for a scan) or a controller id (for status/action). */
    target: string;
    label: string;
    status: ControllerOpStatus;
    origin: ControllerOpOrigin;
    progress?: ControllerOpProgress;
    startedAt: string;
    finishedAt?: string;
    error?: string;
}

/** One of this host's external IPv4 networks — the pickable scan targets. */
export interface ControllerNetwork {
    name: string; // interface name, e.g. "eth0" / "Wi-Fi"
    address: string; // the interface's own IPv4
    network: string; // network CIDR, e.g. "192.168.1.0/24"
}

/** Persisted per-network policy, keyed by CIDR. */
export interface NetworkPolicy {
    cidr: string;
    /**
     * false ⇒ device-proxy requests into this network are refused, so remote
     * clients (a browser on another machine, the cloud UI) cannot reach its
     * devices through this player. Local scanning and discovery are NOT
     * affected — this is about who may come in from outside, not about which
     * networks we look at ourselves.
     */
    allow?: boolean;
    /** We expect light controllers on this network. */
    expectControllers?: boolean;
    note?: string;
}

export interface ControllerOpsState {
    /** This host's networks, for the scan picker. */
    interfaces: ControllerNetwork[];
    /** Last-known controllers, keyed by "<ip>|<via>". */
    devices: Record<string, DiscoveredController>;
    /** In-flight + recently-finished operations, keyed by op id. */
    operations: Record<string, ControllerOp>;
    /** Controllers known from xLights ∪ our records, independent of any scan. */
    known?: KnownController[];
    /** Persisted per-network policies, keyed by CIDR. */
    networkPolicies?: NetworkPolicy[];
    /** Live and last-finished show-content distribution. */
    contentDist?: ContentDistState;
}

/** A command that mutates controller ops — one shape for LAN HTTP, LAN
 *  WebSocket, and cloud, all funneling into the same dispatcher. */
export type ControllerCommand =
    | {
          cmd: 'scan';
          /** Omit to scan the host's own networks. */
          networks?: { cidr: string }[];
          depth: 'sweep' | 'identify' | 'full';
          recurseFppProxies?: boolean;
          recurseEzpProxies?: boolean;
      }
    | {
          /** Deep-read one controller (fills its `detail`). Pass `address` too
           *  and the read works even before any scan. */
          cmd: 'status';
          id: string;
          address?: string;
          depth?: 'full';
      }
    | {
          /** Re-enumerate this host's networks into `interfaces`. */
          cmd: 'refreshInterfaces';
      }
    | {
          /** Cancel an op by id: a running scan, or any op still queued. */
          cmd: 'cancel';
          opId: string;
      }
    | {
          /** Remove a finished op (typically a failure) from the shared list,
           *  so it is gone for every client. */
          cmd: 'dismiss';
          opId: string;
      }
    | {
          /** Run a driver-enumerated action (see ControllerDeviceAction) by id. */
          cmd: 'action';
          id: string;
          action: string;
      }
    | {
          /** Merge a patch into the persisted policy for one network (created
           *  if absent). */
          cmd: 'network';
          cidr: string;
          patch: Partial<Omit<NetworkPolicy, 'cidr'>>;
      }
    | {
          /** Push xLights-derived config to one scanned controller: input/universe
           *  config (`inputs`), string/port outputs (`strings`), or both (`full`).
           *
           *  `outputs` is the player's side of the same coin and takes the whole
           *  show, not one controller: it writes the universes this device
           *  SENDS, so an FPP can drive the show itself. A controller marked
           *  "xLights Only" lands there inactive, because it plays its own copy
           *  and takes sync rather than pixels. */
          cmd: 'upload';
          id: string;
          scope: 'inputs' | 'strings' | 'full' | 'outputs';
          /** Full-control mode: settings a model did NOT set are stamped with
           *  controller defaults instead of inheriting the device's current values. */
          fullControl?: boolean;
      }
    | {
          /** Send show content (sequences and the media they name) to FPP
           *  targets and register it in the inventory playlist. Omit `ids` for
           *  every target that should hold content, `sequences` for the whole
           *  show. */
          cmd: 'distribute';
          ids?: string[];
          sequences?: string[];
          /** Work out what each target is missing and report it, send nothing. */
          checkOnly?: boolean;
          /**
           * Send every file instead of asking each device whether it already
           * has it. For when the show's files have been rebuilt: a re-render
           * that moves models inside a controller's channel range produces a
           * cut with the same start, count, frames and size as the one on the
           * card, which no check a firmware supports can tell apart.
           */
          force?: boolean;
      }
    | {
          /** Create/update/soft-delete/associate/promote a persisted controller
           *  record: `patch` is merged into the record named `name` (created if
           *  absent), then `known` is re-derived and broadcast. */
          cmd: 'record';
          name: string;
          patch: EzpControllerRecordPatch;
      };

// ---------------------------------------------------------------------------
// Show-content distribution — sequences and their media onto the devices that
// play them. The engine lives in @ezplayer/epp-controllers; these are the
// serializable shapes broadcast to every UI, as `DiscoveredController` mirrors
// the discovery library's own device type.
// ---------------------------------------------------------------------------

/** How a file was sent: FPP 7+ chunked PATCH, or FPP 6's upload-then-move. */
export type ContentUploadMethod = 'patch' | 'jqupload';

/** 'fpp' takes the show's own files; 'card' needs a file built for it. */
export type ContentFamily = 'fpp' | 'card';

/** The families that play from a card of their own rather than FPP's store. */
export const CARD_DRIVER_TYPES: ReadonlySet<string> = new Set(['Falcon', 'Genius', 'HinksPix']);

/**
 * Which family of content holder this driver belongs to, or undefined for a
 * device that keeps nothing.
 *
 * Membership is per family, not per device: whether *this* box can really take
 * content depends on its model and firmware (a Falcon V3 has no card, a Genius
 * on 1.x has no upload endpoint, an EasyLights has no slot), and only the
 * connected driver's content profile knows. So this answers who is worth
 * asking -- which is also what a UI needs in order to offer the action at all.
 */
export function contentFamilyOf(driverType: string | undefined): ContentFamily | undefined {
    if (driverType === 'FPP') return 'fpp';
    return driverType && CARD_DRIVER_TYPES.has(driverType) ? 'card' : undefined;
}

/** What this device holds, as of the last distribution or check. */
export interface ControllerContentStatus {
    /** ISO timestamp of the check or distribution this came from. */
    checkedAt: string;
    /** Items already present and current. */
    current: number;
    /** Items the device still needs. */
    missing: number;
    /** What sending the missing items would transfer. */
    missingBytes: number;
    /** Items whose last send failed — the reason to re-run against this device. */
    failed: number;
    /** Set when the device could not be reached or refused the transfer. */
    error?: string;
    uploadMethod?: ContentUploadMethod;
}

/** True when this device is behind the show and a run would send something. */
export function needsContentDelivery(status: ControllerContentStatus | undefined): boolean {
    return !!status && (status.missing > 0 || status.failed > 0 || !!status.error);
}

export type ContentDistPhase = 'waiting' | 'checking' | 'uploading' | 'registering' | 'done' | 'failed';

/**
 * What one line of a distribution report is about. `playlist` and `mode` are
 * the two halves of setting a device up to play what it was sent: what it
 * should play, and the role it plays it in. Only a controller that plays from
 * its own card needs telling either; an FPP keeps its own.
 */
export type ContentItemKind = 'sequence' | 'media' | 'playlist' | 'mode';

/** `planned` is a check-only result: what a real run would have sent. */
export type ContentItemAction = 'uploaded' | 'skipped' | 'failed' | 'planned';

/** One file's outcome against one device. */
export interface ContentDistItem {
    kind: ContentItemKind;
    name: string;
    action: ContentItemAction;
    /** Why it was sent or skipped, in the words the device's own metadata gave. */
    reason: string;
    bytes: number;
    ms: number;
    method?: ContentUploadMethod;
}

export interface ContentDistTargetReport {
    /** Device id, matching `ControllerOpsState.devices`. */
    id: string;
    /** One line naming the device: the name and the address together. */
    label: string;
    /** What the show calls this controller -- its record name, which is the
     *  name on the controllers grid. Absent on a report from an older run. */
    name?: string;
    /** Where it was reached, for a report that has to identify it on its own. */
    address?: string;
    hostName: string;
    version?: string;
    platform?: string;
    supported: boolean;
    uploadMethod?: ContentUploadMethod;
    items: ContentDistItem[];
    bytesUploaded: number;
    startedAt: string;
    finishedAt: string;
    /** Set when nothing was attempted against this device, with the reason —
     *  passed over (too old, nothing to hold) or abandoned part way. */
    note?: string;
}

/** Whether a device came out of a run behind the show: it was skipped, it
 *  stopped part way, or one of its files would not go. */
export function contentTargetFailed(target: ContentDistTargetReport): boolean {
    return !target.supported || !!target.note || target.items.some((i) => i.action === 'failed');
}

export interface ContentDistTotals {
    targets: number;
    targetsFailed: number;
    uploaded: number;
    skipped: number;
    failed: number;
    planned: number;
    bytes: number;
}

/** A finished run — what the details dialog shows. */
export interface ContentDistReport {
    startedAt: string;
    finishedAt: string;
    /** A check: nothing was sent, and every item reads `planned`. */
    checkOnly: boolean;
    cancelled: boolean;
    /** Why the run happened, for the Show Status card's one-line summary. */
    trigger: ContentDistTrigger;
    targets: ContentDistTargetReport[];
    totals: ContentDistTotals;
    /**
     * Why a run did nothing: no songs yet, or nobody in the layout plays their
     * own copy. Reported as an empty report rather than as a failure.
     */
    note?: string;
}

/** What started a run. `songs` is the automatic follow-up to content the user
 *  or the cloud poller added. */
export type ContentDistTrigger = 'manual' | 'schedule' | 'songs';

export interface ContentDistTargetProgress {
    id: string;
    label: string;
    /** See {@link ContentDistTargetReport.name}. */
    name?: string;
    /** See {@link ContentDistTargetReport.address}. */
    address?: string;
    phase: ContentDistPhase;
    /** The file in flight. */
    item?: string;
    /** 0..1 for this device. */
    fraction: number;
    bytesSent: number;
    bytesTotal: number;
    itemsDone: number;
    itemsTotal: number;
    failures: number;
    message?: string;
}

/** A run in flight. Byte totals are known before the first byte moves, so the
 *  fraction is honest rather than a guess that lurches. */
export interface ContentDistRun {
    /** The `distribute` op this run belongs to, for cancel and for the op list. */
    opId: string;
    startedAt: string;
    checkOnly: boolean;
    trigger: ContentDistTrigger;
    /** 0..1 over the whole run; never goes backwards. */
    fraction: number;
    bytesSent: number;
    bytesTotal: number;
    targets: ContentDistTargetProgress[];
}

export interface ContentDistState {
    /** Present only while a run is in flight. */
    run?: ContentDistRun;
    /** The last run that finished, check or real. */
    lastReport?: ContentDistReport;
    /** Sequences waiting for the next automatic run, by file name. */
    queued?: string[];
    /** Why automatic distribution is not acting right now, for the card to
     *  explain itself: off by setting, outside its window, or nothing to do. */
    autoHold?: 'off' | 'outside-window' | 'idle';
}

// ---------------------------------------------------------------------------
// Reconciliation — known records vs. what the scan actually found.
// ---------------------------------------------------------------------------

/**
 * Whether a known controller participates in the show:
 *  - `enabled`      output to it (xLights "Active")
 *  - `disabled`     don't output (xLights "Inactive")
 *  - `xlightsOnly`  defined for xLights' own use; players don't output to it
 */
export type ControllerEnableState = 'enabled' | 'disabled' | 'xlightsOnly';

/**
 * The mode the show needs a controller's own player to be in.
 *
 *  - `player`  runs the show from its own copy of the content
 *  - `remote`  drives its own channels from its own copy, following sync
 *  - `show`    plays nothing of its own and takes the show's live pixel data
 *
 * `show` is the one every ordinary controller wants, and it exists because the
 * other two have to be reversible: a box that was experimented on, bought
 * second-hand, or reconfigured can be sitting in `player` with no way back, and
 * a controller in `player` mode takes no pixel data at all -- so its share of
 * the display goes dark.
 */
export type ControllerPlayerMode = 'player' | 'remote' | 'show';

/**
 * What we have been told a controller's part in the show is -- the final word,
 * which is why it lives on our own record rather than being re-derived.
 *
 *  - `enabled`   in the show and sent pixel data (xLights "Active")
 *  - `disabled`  not in the show at all (xLights "Inactive")
 *  - `player`    plays the show itself, from its own copy of the content
 *  - `remote`    plays its own channels from its own copy, following sync
 *
 * `enabled` and `player` resolve to the same role. The distinction is for the
 * operator: on a device that cannot hold content the role is meaningless, and
 * calling that state "player" in the UI would invite the question.
 */
export type ControllerActiveState = 'enabled' | 'disabled' | 'player' | 'remote';

/** Whether this state keeps the controller out of the show entirely. */
export function isDisabledState(a: ControllerActiveState | undefined): boolean {
    return a === 'disabled';
}

/**
 * Read a stored `active`, which was a boolean before it carried a role.
 *
 * A stored `true` becomes "no opinion" rather than `enabled`: it is the default
 * every record was written with, never something an operator chose, so treating
 * it as a choice would let it override the layout. A stored `false` was a
 * deliberate Disable, so it survives.
 */
export function activeStateFrom(value: unknown): ControllerActiveState | undefined {
    if (value === false) return 'disabled';
    if (value === true) return undefined;
    return value === 'enabled' || value === 'disabled' || value === 'player' || value === 'remote' ? value : undefined;
}

/** The resolved part a controller plays, with what the device itself said. */
export interface ResolvedControllerRole {
    /** The part it plays; `none` when it is not in the show. */
    role: 'player' | 'remote' | 'none';
    /** Which stage of the pipeline decided. */
    source: 'record' | 'layout' | 'device' | 'default';
    /** The device's own word, kept rather than replaced -- see below. */
    reported?: string;
    /** The disagreement between the two, as a sentence, when there is one. */
    drift?: string;
}

/**
 * Resolve what part a controller plays.
 *
 * A pipeline, not a lookup: discovery seeds what the device says, the layout
 * overrides that, and our own record is the final word. Each stage speaks only
 * when it has something to say, so an unedited record defers to the layout and
 * a layout with no opinion defers to the device.
 *
 * `reported` is carried beside the answer instead of being replaced by it. The
 * disagreement between what we want and what the device says IS the drift the
 * operator acts on, so a resolver that overwrote it would leave drift
 * detection with nothing to compare.
 */
export function resolveControllerRole(k: {
    role?: ControllerActiveState;
    enableState?: ControllerEnableState;
    protocol?: string;
    model?: string;
    vendor?: string;
    reportedMode?: string;
}): ResolvedControllerRole {
    const reported = k.reportedMode;
    const answer = (role: ResolvedControllerRole['role'], source: ResolvedControllerRole['source']) => {
        const want = role === 'none' ? undefined : role;
        const drift = playerModeDrift(reported, want);
        return { role, source, ...(reported ? { reported } : {}), ...(drift ? { drift } : {}) };
    };

    // 1. What we were told.
    if (k.role === 'disabled') return answer('none', 'record');
    if (k.role === 'remote') return answer('remote', 'record');
    if (k.role === 'player' || k.role === 'enabled') return answer('player', 'record');

    // 2. A player-only entry owns no channels, so xLights records it as
    //    "xLights Only" to keep the show's pixels off it. That means "send
    //    this nothing", not "this is a remote" -- it is the show's player.
    if (isPlayerOnlyRecord(k)) return answer('player', 'layout');

    // 3. What the layout asks. A family that cannot follow our sync is no
    //    remote however the layout marks it -- it plays its own content.
    if (k.enableState === 'xlightsOnly') return answer(canFollowShowSync(k) ? 'remote' : 'player', 'layout');
    if (k.enableState === 'disabled') return answer('none', 'layout');
    if (k.enableState === 'enabled') return answer('player', 'layout');

    // 4. What the device says of itself, when nothing above has an opinion.
    if (reported) {
        const have = reportedPlayerRole(reported);
        if (have === 'remote') return answer('remote', 'device');
        if (have === 'player') return answer('player', 'device');
    }
    return answer('none', 'default');
}

/**
 * Whether to watch this controller: ping it, identify it, and let content and
 * config reach it. Everything the layout or an operator names is watched --
 * a remote that is down costs its whole share of the display, and nothing
 * else in the product would say so. Only a disabled controller is ignored.
 */
export function shouldWatchController(k: {
    address?: string;
    role?: ControllerActiveState;
    enableState?: ControllerEnableState;
    protocol?: string;
    model?: string;
}): boolean {
    if (!k.address?.trim()) return false;
    if (k.role === 'disabled') return false;
    if (k.role) return true;
    return k.enableState !== 'disabled';
}

/**
 * The role the layout asks of a controller. "xLights Only" is how xLights
 * records a show remote: the controller keeps its channels in the layout, but
 * a player must not send it pixel data. An `Inactive` controller is not in the
 * show at all, so it implies no role.
 */
export function isPlayerOnlyRecord(k: { protocol?: string; model?: string }): boolean {
    return k.protocol?.toLowerCase() === 'player only' || k.model?.toLowerCase() === 'fpp player only';
}

/**
 * The mode the layout wants this controller's own player in, or undefined when
 * the show has no opinion -- a disabled controller, or a record that says
 * nothing at all.
 *
 * Built on {@link contentRoleOf} rather than {@link resolveControllerRole},
 * because the two answer different questions. The resolver says *who plays the
 * show*, and an ordinary Active controller resolves to `player` on the strength
 * of a player driving it. That is not the mode the box itself should be in: an
 * ordinary controller must be in `show`, taking live pixel data. Only a
 * controller that holds its own copy belongs in `player` or `remote`.
 */
export function layoutPlayerMode(k: {
    role?: ControllerActiveState;
    enableState?: ControllerEnableState;
    protocol?: string;
    model?: string;
    vendor?: string;
}): ControllerPlayerMode | undefined {
    // Out of the show entirely: not ours to touch.
    if (k.role === 'disabled') return undefined;
    if (!k.role && k.enableState === 'disabled') return undefined;
    const content = contentRoleOf(k);
    if (content !== 'none') return content;
    // In the show and holding no copy of its own, so it has to be taking the
    // show's data. A record with no opinion at all stays undefined.
    return k.role === 'enabled' || k.enableState === 'enabled' ? 'show' : undefined;
}

/** What part a controller plays in content distribution. */
export type ContentRole = 'player' | 'remote' | 'none';

/**
 * Whether this controller can play its own content in step with the show's
 * sync, which is what being a remote means.
 *
 * A HinksPix cannot. Its SLAVE role follows another HinksPix master over that
 * family's own sync, not the multisync the show sends, and nothing we know of
 * takes a box back out of that role -- so arming one as a remote would leave
 * it waiting for a master that does not exist, with no way back. A HinksPix
 * gets content and nothing else.
 *
 * An unknown vendor is assumed able: this decides how to read a layout, and
 * {@link ControllerPlayerMode} writes are refused by the driver that cannot
 * honour them, which is the check that does not depend on knowing the family.
 */
export function canFollowShowSync(k: { vendor?: string }): boolean {
    return k.vendor?.toLowerCase() !== 'hinkspix';
}

/**
 * Whether a controller plays from its own copy of the show's files, and as
 * what. A narrower question than {@link resolveControllerRole}.
 *
 * A remote plays its own channels from its own copy, and the show's player
 * plays the whole show from its copy, so both need files. An Active controller
 * also *resolves* to the role 'player' -- the layout has it in the show, and a
 * player is what drives it -- but its pixels arrive live over the wire, so it
 * needs no files at all. Only a controller named as the player plays from its
 * own copy: an xLights "Player Only" entry, or a record set to Player.
 *
 * `enabled` on a record is the operator saying "an ordinary controller in the
 * show", which is the one answer that rules both roles out.
 */
export function contentRoleOf(k: {
    role?: ControllerActiveState;
    enableState?: ControllerEnableState;
    protocol?: string;
    model?: string;
    vendor?: string;
}): ContentRole {
    if (k.role === 'remote') return 'remote';
    if (k.role === 'player') return 'player';
    if (k.role === 'disabled' || k.role === 'enabled') return 'none';
    if (isPlayerOnlyRecord(k)) return 'player';
    // "xLights Only" says the player sends this one no pixel data. For a
    // family that can follow our sync that makes it a remote; one that cannot
    // still holds its own copy, so it is given content as a player.
    if (k.enableState === 'xlightsOnly') return canFollowShowSync(k) ? 'remote' : 'player';
    return 'none';
}

/**
 * Read a device's own word for its mode as one of the three modes we ask for.
 *
 * Every family names these differently and none of them uses ours: a Falcon
 * says "FPP Player", "FPP Master", "FPP Remote", "DDP" or "E1.31/ArtNet", a
 * HinksPix says "MASTER", "SLAVE" or "ETHERNET", an FPP says "player",
 * "master", "remote" or "bridge", and a Genius says "standalone", "remote",
 * "ddp", "e131" or "artnet". Matching the bare words is what made a Falcon in
 * FPP Player mode read as drifted from a layout that wanted exactly that.
 *
 * Anything that is not a content-playing role is a live-data mode. That is the
 * default on purpose: a protocol name we have never seen should read as "this
 * controller is taking the show's data", not as drift.
 */
export function reportedPlayerRole(reported: string): ControllerPlayerMode {
    const have = reported.toLowerCase();
    // 'slave' is the HinksPix word; 'remote' covers FPP and "FPP Remote".
    if (have.includes('remote') || have.includes('slave')) return 'remote';
    // A master is a player that also sends sync, so it satisfies 'player'.
    if (have.includes('player') || have.includes('master') || have.includes('standalone')) return 'player';
    return 'show';
}

/**
 * Whether a box in this mode takes the show's live pixel data. An FPP in
 * player mode does whenever nothing is playing: it has no separate live-data
 * mode, and a write of the old "bridge" comes back as player. Any other
 * family's player plays from its own card and takes none.
 */
export function takesLiveData(reported: string, driverType?: string): boolean {
    const role = reportedPlayerRole(reported);
    return role === 'show' || (role === 'player' && driverType === 'FPP');
}

/**
 * How a device's own reported role differs from the one the layout asks for,
 * as a sentence for the operator — undefined when they agree or when either
 * side is unknown. The layout is the intent, so a disagreement means the
 * device has not been configured for this show, or was changed behind our back.
 */
export function playerModeDrift(
    reported: string | undefined,
    want: ControllerPlayerMode | undefined,
    driverType?: string,
): string | undefined {
    if (!want || !reported) return undefined;
    if (reportedPlayerRole(reported) === want) return undefined;
    if (want === 'show' && takesLiveData(reported, driverType)) return undefined;
    return want === 'show'
        ? `the layout wants this controller taking the show's data, but it reports "${reported}"`
        : `the layout wants this controller as a ${want}, but it reports "${reported}"`;
}

/**
 * A controller known ahead of (or independent of) any scan: an xLights
 * networks.xml controller, unioned with our own overrides/records. `name` is
 * the primary key; `address` is the only network-discoverable join back to a
 * scanned device.
 */
export interface KnownController {
    /** Primary key: xLights controller name, or a user-assigned one. */
    name: string;
    /** IP or hostname. Undefined ⇒ unjoinable. */
    address?: string;
    /** Boolean collapse of `enableState` (`xlightsOnly` counts as true). */
    active?: boolean;
    /** What the layout asks, untouched by our record, so drift has a baseline. */
    enableState?: ControllerEnableState;
    /**
     * What our own record says the controller's part is, which outranks the
     * layout. Absent means the record has no opinion -- not that it is a
     * plain controller. See {@link resolveControllerRole}.
     */
    role?: ControllerActiveState;
    /** Reachable even when it will not answer a ping. */
    presumeUp?: boolean;
    vendor?: string;
    model?: string;
    variant?: string;
    /** xLights defaults applied when uploading in full-control mode. */
    defaultBrightness?: number;
    defaultGamma?: number;
    /** Output protocol, e.g. 'E131' / 'DDP'. */
    protocol?: string;
    /**
     * The FPP this controller is reached through, from xLights' `FPPProxy`
     * attribute (or the networks root's `GlobalFPPProxy`). It is how a layout
     * records a controller on a network we cannot see ourselves: every request
     * for it has to go `http://<proxy>/proxy/<address>`. A device discovery
     * found behind a proxy already knows its own; this is the only place a
     * device we learned by address can learn it.
     */
    proxy?: string;
    /** xLights' Monitor flag: whether a player should health-check this one. */
    monitor?: boolean;
    /** E1.31 packet priority xLights declares (upstream default 100). */
    priority?: number;
    /** xLights' Suppress Duplicate Frames option. */
    suppressDuplicates?: boolean;
    /** Absolute 1-based channel span. */
    startChannel?: number;
    channelCount?: number;
    /** xLights intent: which model(s)/pixels should plug into each physical port */
    ports?: ControllerPortIntent[];
    /** xLights intent for the controller's serial ports */
    serialPorts?: ControllerSerialPortIntent[];
    /** xLights intent for the controller's LED panel matrices. */
    panelMatrices?: ControllerPanelMatrixIntent[];
    /** xLights intent for models on the controller's HDMI virtual matrices. */
    virtualMatrices?: ControllerVirtualMatrixIntent[];
    /** Rich per-(model,string) intent for config upload; superset of `ports`. */
    modelIntents?: ControllerModelIntent[];
    /** Pixel / serial ports the controller model has, from its capability
     *  definition (so a port map can draw the unused ones too). */
    pixelPortCount?: number;
    serialPortCount?: number;
    /** Outputs (universes/channel blocks) from xlights_networks.xml. */
    outputs?: ControllerOutputIntent[];
    /**
     * Max frame rate xLights declares for this controller — the EZPlayer
     * `[MFT:<ms>]` tag in the controller Description, as frames per second.
     * Undefined ⇒ no limit declared.
     */
    maxFps?: number;
    /** Our record's max-FPS override, when set; wins over `maxFps`. */
    fpsOverride?: number;
    /**
     * This computer's address the layout sends this controller's data from:
     * xLights' Force Local IP on the controller, or the Controllers tab's
     * Global Force Local IP. The sender binds to it, so one this computer no
     * longer has would send nothing.
     */
    forceLocalIP?: string;
    /** Our record's send-from address, when set; wins over `forceLocalIP`. */
    forceLocalIPOverride?: string;
    /** Provenance of the record. */
    source: 'xlights' | 'ezp' | 'both';
}

/** The frame-rate cap in effect for a known controller: the record override,
 *  else the xLights declaration, else none. */
export function effectiveMaxFps(k: { maxFps?: number; fpsOverride?: number }): number | undefined {
    return k.fpsOverride ?? k.maxFps;
}

/** The address a known controller's data is sent from: the record override,
 *  else the xLights declaration, else none (the route picks the interface). */
export function effectiveForceLocalIP(k: { forceLocalIP?: string; forceLocalIPOverride?: string }): string | undefined {
    return k.forceLocalIPOverride ?? k.forceLocalIP;
}

/** xLights intent for one serial (DMX / Renard / Pixelnet / …) output port. */
/**
 * xLights intent for one LED panel matrix: the channel range a matrix port must
 * carry. Panel size, layout and wiring stay on the controller; this is only
 * what to point the matrix at.
 */
export interface ControllerPanelMatrixIntent {
    /** 1-based matrix number (xLights ControllerConnection Port). */
    port: number;
    /** Model names drawn on the matrix, in channel order. */
    models: string[];
    /** Absolute 1-based first channel of the matrix's models. */
    startChannel: number;
    /** Channels the models span, first model's first through last model's last. */
    channels: number;
    /** The xLights protocol, which names the driver family allowed to serve it
     *  ("LED Panel Matrix", "… - Hat/Cap/Cape", "… - ColorLight"). */
    protocol: string;
    /** Size in pixels of the first model, when its strings describe a grid. */
    width?: number;
    height?: number;
}

/** xLights intent for one model drawn on an HDMI/framebuffer virtual matrix. */
export interface ControllerVirtualMatrixIntent {
    /** 1-based HDMI output (xLights ControllerConnection Port). */
    port: number;
    model: string;
    /** Absolute 1-based first channel. */
    startChannel: number;
    channels: number;
    /** Size in pixels, from the matrix model's strings and nodes. */
    width: number;
    height: number;
}

export interface ControllerSerialPortIntent {
    /** 1-based serial port number (xLights ControllerConnection Port). */
    port: number;
    /** Model names on the port, in channel order. */
    models: string[];
    /** Channels the port must carry (first model's first channel through the
     *  last model's last channel). */
    channels: number;
    /** Absolute 1-based first channel of the port's channel span. */
    startChannel?: number;
    /** Serial protocol, lowercase (e.g. 'dmx', 'renard'). */
    protocol?: string;
    /** Where each model sits on the port.  Serial fixtures are often addressed
     *  by channel, not chained like pixels, so this is what someone sets on the
     *  fixture. Parallel to `models` when present. */
    modelChannels?: ControllerSerialModelIntent[];
}

/** One model's channel placement on a serial port. */
export interface ControllerSerialModelIntent {
    name: string;
    /** Absolute 1-based first show channel. */
    startChannel: number;
    channels: number;
}

/** A controller's ACTUAL serial port config as read from the device. */
export interface ControllerSerialPort {
    port: number;
    protocol?: string;
    /** First channel (1-based): absolute on FPP, device-local on HinksPix. */
    startChannel?: number;
    channels?: number;
    universe?: number;
    /** Device name / label when the controller has one (e.g. FPP "DMX1"). */
    device?: string;
    model?: string;
}

/** An LED panel matrix as read from the controller. */
export interface ControllerPanelMatrix {
    /** 1-based matrix number, as the controller's own UI labels it. */
    port: number;
    /** The driver serving it, e.g. "ColorLight5a75", "BBShiftPanel", "RGBMatrix". */
    driver?: string;
    enabled: boolean;
    startChannel: number;
    channels: number;
    width?: number;
    height?: number;
    panelCount?: number;
    name?: string;
}

/** An HDMI/framebuffer virtual matrix as read from the controller. */
export interface ControllerVirtualMatrix {
    /** The model name the matrix was uploaded for. */
    name?: string;
    /** 1-based output the device name implies. */
    port?: number;
    enabled: boolean;
    startChannel: number;
    channels: number;
    width?: number;
    height?: number;
    /** e.g. "HDMI-A-1" or "fb0". */
    device?: string;
}

/** Per-(model,string) upload intent. Optional fields absent ⇒ "not set in
 *  xLights" (inherit semantics), so do not default-fill them. */
export interface ControllerModelIntent {
    name: string;
    /** 1-based physical port from the model's ControllerConnection. */
    controllerPort: number;
    protocol: string;
    /** Absolute 1-based start channel. */
    startChannel: number;
    nodeCount: number;
    channels?: number;
    channelsPerPixel?: number;
    colorOrder?: string;
    nullPixels?: number;
    endNullPixels?: number;
    brightness?: number;
    gamma?: number;
    groupCount?: number;
    reverse?: boolean;
    zigZag?: number;
    smartRemote?: number;
    smartRemoteType?: string;
    ts?: number;
    /** Multi-string models: per-string absolute start channels / node counts /
     *  channel counts (parallel arrays). Absent ⇒ single string. */
    stringStartChannels?: number[];
    stringNodeCounts?: number[];
    stringChannels?: number[];
    /** xLights SRCascadeOnPort / SRMaxCascade (default 1). */
    srCascadeOnPort?: boolean;
    srMaxCascade?: number;
}

/** One output (universe / channel block) of a controller, from networks.xml. */
export interface ControllerOutputIntent {
    /** Output protocol, lowercase: 'e131' | 'artnet' | 'ddp' | … */
    type: string;
    universe?: number;
    /** Absolute 1-based start channel of this output. */
    startChannel: number;
    channels: number;
    /** DDP: xLights' Keep Channel Numbers option (data offsets are absolute). */
    keepChannelNumbers?: boolean;
}

/**
 * Our persisted controller record/override, stored one-JSON-file-per-record at
 * `<showFolder>/.ezplayer/controllers/<name>.json`. `name` is canonical (the
 * filename is only a sanitized handle).
 */
export interface EzpControllerRecord {
    /** Controller name — the join key to xLights and our primary key. */
    name: string;
    /** Override the xLights address; also how `associate`/`promote` bind a
     *  record to a discovered IP. */
    address?: string;
    /**
     * The controller's part in the show: Enable / Disable, or Player / Remote
     * for a device that holds its own copy. Absent means "no opinion" and the
     * layout decides. Stored as a boolean by older builds -- read it through
     * {@link activeStateFrom}.
     */
    active?: ControllerActiveState;
    /**
     * Treat as reachable even when it does not answer a ping.
     *
     * Some controllers are up and serving while silently dropping ICMP, and
     * there is no rule that predicts which. Without this they are reported
     * absent and -- worse -- skipped by content distribution, which refuses an
     * unreachable target so a run cannot hang on it.
     */
    presumeUp?: boolean;
    /** Override controller identity for capability resolution, matching the
     *  vendor/model/variant keys of the bundled .xcontroller definitions. */
    vendor?: string;
    model?: string;
    variant?: string;
    /** Soft delete — hidden from the grid, file kept. */
    deleted?: boolean;
    /** No xLights backing — created by us, or promoted from an unregistered find. */
    own?: boolean;
    /** Max-FPS override (supersedes the xLights description). */
    fpsOverride?: number;
    /** This computer's address to send from (supersedes the xLights Force Local IP). */
    forceLocalIP?: string;
    notes?: string;
}

/** A partial edit merged into a record by the `record` command (create if absent). */
export type EzpControllerRecordPatch = Partial<Omit<EzpControllerRecord, 'name'>>;

/**
 * How a grid row relates our known records to the live scan:
 *  - `present`      a known record we also found on the network
 *  - `absent`       we looked for it and it was not there
 *  - `unknown`      we have not looked yet, so nothing is claimed either way
 *  - `presumed`     it did not answer, but its record says to presume it up
 *  - `unregistered` a network find matching no record (a "ghost")
 *
 * `absent` and `unknown` are kept apart because "we pinged and it is gone" is a
 * much stronger claim than "we never pinged it".
 */
export type ControllerRecordState = 'present' | 'absent' | 'unknown' | 'presumed' | 'unregistered';

/** One row of the reconciliation grid. */
export interface ControllerGridRow {
    /** Stable key: the known name, or `ghost:<id>` for an unregistered find. */
    key: string;
    state: ControllerRecordState;
    /** Known-record name; undefined for an unregistered ghost until promoted. */
    name?: string;
    /** The known record's configured address. */
    address?: string;
    /** The matched (present) or unclaimed (unregistered) scanned device. */
    device?: DiscoveredController;
    vendor?: string;
    model?: string;
    /** The layout's output protocol; "Player Only" is how it names a player. */
    protocol?: string;
    active?: boolean;
    /** What our record says this controller's part is; absent = no opinion. */
    role?: ControllerActiveState;
    /** Reachable even when it will not answer a ping. */
    presumeUp?: boolean;
    /** Three-way enable state (`active` is its boolean collapse). */
    enableState?: ControllerEnableState;
    source?: KnownController['source'];
    /** xLights per-port intent, reconciled against the device's `pixelPorts`. */
    intent?: ControllerPortIntent[];
    /** Rich per-(model,string) intent; superset of `intent`. */
    modelIntents?: ControllerModelIntent[];
    /** xLights serial-port intent, reconciled against the device's `serialPorts`. */
    serialIntent?: ControllerSerialPortIntent[];
    /** xLights LED panel matrix intent. */
    panelMatrixIntent?: ControllerPanelMatrixIntent[];
    /** xLights virtual (HDMI) matrix intent. */
    virtualMatrixIntent?: ControllerVirtualMatrixIntent[];
    /** Port counts from the controller's capability definition. */
    pixelPortCount?: number;
    serialPortCount?: number;
    /** xLights output/universe intent, reconciled against the device's `inputs`. */
    outputs?: ControllerOutputIntent[];
    /** The controller's absolute 1-based start channel in xLights. */
    startChannel?: number;
    /** Frame-rate cap: xLights declaration and our override (see KnownController). */
    maxFps?: number;
    fpsOverride?: number;
    /** Send-from address: xLights declaration and our override (see KnownController). */
    forceLocalIP?: string;
    forceLocalIPOverride?: string;
    /** Live health overlaid from the playback pipeline, joined by address/name. */
    health?: ControllerHealth;
}

/**
 * A controller's data sender as it sees itself.  Counts are UDP packets, not
 * frames: a frame takes several per controller, plus the push or sync packet.
 * `skipped` counts packets the sender dropped (suspended, or not connected);
 * `errors` counts sends the OS refused.  Cumulative since the show's output
 * was opened.
 */
export interface ControllerSenderStats {
    connected: boolean;
    sent: number;
    skipped: number;
    errors: number;
    bytes: number;
    lastError?: string;
}

/** Live per-controller health from the playback/status pipeline — the runtime
 *  signals a static xLights read + one-shot scan don't provide. */
export interface ControllerHealth {
    /** Rolling ICMP ping result. */
    connectivity?: 'Up' | 'Down' | 'Pending' | 'N/A';
    /** e.g. "8 out of 10 pings". */
    pingSummary?: string;
    /** How the controller last answered; absent when nothing answered. */
    reachedVia?: 'ping' | 'web';
    /** Data-plane sender state: opened, config-skipped, connect-failed, or unusable. */
    status?: 'open' | 'skipped' | 'error' | 'unusable';
    /** What the sender itself reports having sent; absent until it is opened. */
    senderStats?: ControllerSenderStats;
    errors?: string[];
    notices?: string[];
}

// ---------------------------------------------------------------------------
// Model↔port reconciliation — xLights INTENT vs. the controller's ACTUAL config.
// ---------------------------------------------------------------------------

/** xLights intent for one physical port: the model(s) whose strings land here
 *  once multi-string spreads and smart-remote cascades are expanded. */
export interface ControllerPortIntent {
    port: number;
    /** Bare model name(s) landing on this port, data-chain order, deduplicated. */
    models: string[];
    /** Display labels parallel to `models`, annotated with string segment(s)
     *  and smart-remote slots — e.g. `"Tree [2/4]"`, `"Matrix [1,2/4 AB]"`. */
    modelLabels?: string[];
    /** Pixels expected ON THIS PORT (landing strings only, not whole-model totals). */
    pixels: number;
    /** Channels those pixels take, when known. A one-channel node is a pixel to
     *  the layout and a third of one to a controller, so a count in channels is
     *  what the two sides can agree on. */
    channels?: number;
    /** Pixel protocol declared for the port, when present. */
    protocol?: string;
    /** Absolute 1-based start channel of the port's first string. */
    startChannel?: number;
}

/** One input universe as configured on the device (E1.31/ArtNet). */
export interface ControllerInputUniverseInfo {
    universe: number;
    channels: number;
    /** Device-local start channel for this universe (1-based), when reported. */
    startChannel?: number;
}

/** The device's ACTUAL data-input config, as read from the device. */
export interface ControllerInputInfo {
    /** Normalized: 'e131' | 'artnet' | 'ddp' | driver-specific string. */
    protocol?: string;
    /** DDP: start channel the device listens at (1 unless keep-channel-numbers). */
    startChannel?: number;
    /** DDP: total channels consumed, when reported. */
    channelCount?: number;
    /** E1.31/ArtNet: the universe map, when reported. */
    universes?: ControllerInputUniverseInfo[];
    /** True when the device exposes only part of its input config (e.g. just
     *  the first universe + size) — compare only what's present. */
    partial?: boolean;
}

/** A controller's ACTUAL per-port config as read from the device. */
export interface ControllerPort {
    port: number;
    /** Model name(s) joined into one string (multi-model ports come
     *  " + "-joined) — kept for back-compat display. */
    model?: string;
    /** Per-model names on this port, when known. Preferred over `model`. */
    models?: string[];
    pixels?: number;
    protocol?: string;
    colorOrder?: string;
    startChannel?: number;
    endChannel?: number;
    /** Set when the port is addressed by universe (e.g. AlphaPix); its
     *  `startChannel` is then within that universe, not a show channel. */
    universe?: number;
}

/** Per-port outcome:
 *  - `ok`         intent and actual agree
 *  - `missing`    xLights expects pixels here but the controller has none → reconfig
 *  - `unexpected` the controller has pixels here but xLights assigns none → stale/extra
 *  - `count`      both present but the pixel counts differ; for a matrix, any
 *                 difference in its configuration (see the row's `notes`)
 *  - `start`      counts agree but the port starts at the wrong channel, so it
 *                 shows another part of the show */
export type PortDriftKind = 'ok' | 'missing' | 'unexpected' | 'count' | 'start';

/**
 * How much a drift matters, which is a different question from what it is.
 *
 * `conflict` is config that contradicts what this show needs: the display is
 * wrong until a config upload puts it right. `extra` is config the show simply
 * does not describe — a string or a DMX port left over from another season,
 * sitting on a port this show does not use. Nothing is sent to it, so it
 * changes nothing we do: worth seeing, not worth a warning.
 *
 * The exception is a controller that maps incoming channels by each output's
 * own declared range rather than by port order, where a leftover output moves
 * the outputs we *do* configure. There `extra` is a conflict, and
 * {@link reconcilePorts} is told the driver so it can say so.
 */
export type PortDriftSeverity = 'ok' | 'conflict' | 'extra';

/** One port's intent-vs-actual reconciliation. */
export interface PortReconcile {
    port: number;
    /** Bare intended model names on this port (the comparison set). */
    intendedModels: string[];
    /** Display labels parallel to `intendedModels`. */
    intendedModelLabels?: string[];
    intendedPixels?: number;
    intendedChannels?: number;
    /** Joined device model string — back-compat display value. */
    actualModel?: string;
    /** Per-model device names, when the device reports any. */
    actualModels?: string[];
    actualPixels?: number;
    /** Channels the device port covers, when it says. */
    actualChannels?: number;
    /** Model-set comparison (case-insensitive match, case-preserving values).
     *  Absent when the device reports no model names at all. */
    missingModels?: string[];
    /** Device-reported models xLights assigns elsewhere (or nowhere). */
    extraModels?: string[];
    /** Start channels, set when they disagree (`drift: 'start'`). */
    intendedStart?: number;
    actualStart?: number;
    drift: PortDriftKind;
    /** How much it matters. Absent on a row built by hand in a test;
     *  {@link portDriftSeverity} is the fallback. */
    severity?: PortDriftSeverity;
}

/** One serial port's intent-vs-actual reconciliation (channels, not pixels). */
export interface SerialPortReconcile {
    port: number;
    intendedModels: string[];
    intendedChannels?: number;
    intendedProtocol?: string;
    actualModel?: string;
    actualChannels?: number;
    actualProtocol?: string;
    /** Same vocabulary as pixel ports; `count` means the channel counts differ. */
    drift: PortDriftKind;
    /** How much it matters. Absent on a row built by hand in a test;
     *  {@link portDriftSeverity} is the fallback. */
    severity?: PortDriftSeverity;
}

/** One LED panel matrix's intent-vs-actual reconciliation. */
export interface PanelMatrixReconcile {
    port: number;
    intendedModels: string[];
    intendedStartChannel?: number;
    intendedChannels?: number;
    intendedProtocol?: string;
    intendedWidth?: number;
    intendedHeight?: number;
    actualDriver?: string;
    actualEnabled?: boolean;
    actualStartChannel?: number;
    actualChannels?: number;
    actualWidth?: number;
    actualHeight?: number;
    actualName?: string;
    drift: PortDriftKind;
    /** How much it matters. Absent on a row built by hand in a test;
     *  {@link portDriftSeverity} is the fallback. */
    severity?: PortDriftSeverity;
    /** One line per difference; empty when in sync. */
    notes: string[];
}

/** One HDMI virtual matrix's intent-vs-actual reconciliation, matched by model name. */
export interface VirtualMatrixReconcile {
    /** The model name; the device name for a matrix no model claims. */
    name: string;
    port?: number;
    intendedStartChannel?: number;
    intendedChannels?: number;
    intendedWidth?: number;
    intendedHeight?: number;
    actualEnabled?: boolean;
    actualStartChannel?: number;
    actualChannels?: number;
    actualWidth?: number;
    actualHeight?: number;
    actualDevice?: string;
    drift: PortDriftKind;
    /** How much it matters. Absent on a row built by hand in a test;
     *  {@link portDriftSeverity} is the fallback. */
    severity?: PortDriftSeverity;
    /** One line per difference; empty when in sync. */
    notes: string[];
}
