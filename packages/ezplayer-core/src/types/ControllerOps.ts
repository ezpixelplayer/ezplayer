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
export type ControllerSource =
    | { via: 'direct' }
    | { via: 'fpp-proxy'; proxy: string }
    | { via: 'ezp'; host: string };

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
    /** Actual data-input config read from the device (full depth). */
    inputs?: ControllerInputInfo;
    /** Actions the driver enumerated (filled on status deep-reads). */
    actions?: ControllerDeviceAction[];
    error?: string;
    /** ISO timestamp this controller's info was last refreshed. */
    seenAt: string;
}

export type ControllerOpKind = 'scan' | 'status' | 'action' | 'upload';
/** `cancelled` = stopped on request before completion; partial results kept. */
export type ControllerOpStatus = 'running' | 'done' | 'error' | 'cancelled';
export type ControllerOpOrigin = 'lan' | 'cloud' | 'cli';

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
    name: string;       // interface name, e.g. "eth0" / "Wi-Fi"
    address: string;    // the interface's own IPv4
    network: string;    // network CIDR, e.g. "192.168.1.0/24"
}

/** Persisted per-network policy, keyed by CIDR. */
export interface NetworkPolicy {
    cidr: string;
    /** false ⇒ scans and device-proxy requests into this network are refused. */
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
          /** Cancel a running op by id; currently only scans are cancelable. */
          cmd: 'cancel';
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
           *  config (`inputs`), string/port outputs (`strings`), or both (`full`). */
          cmd: 'upload';
          id: string;
          scope: 'inputs' | 'strings' | 'full';
          /** Full-control mode: settings a model did NOT set are stamped with
           *  controller defaults instead of inheriting the device's current values. */
          fullControl?: boolean;
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
    enableState?: ControllerEnableState;
    vendor?: string;
    model?: string;
    variant?: string;
    /** xLights defaults applied when uploading in full-control mode. */
    defaultBrightness?: number;
    defaultGamma?: number;
    /** Output protocol, e.g. 'E131' / 'DDP'. */
    protocol?: string;
    /** Absolute 1-based channel span. */
    startChannel?: number;
    channelCount?: number;
    /** xLights intent: which model(s)/pixels should plug into each physical
     *  port — the "should-be" side of port reconciliation vs. `pixelPorts`. */
    ports?: ControllerPortIntent[];
    /** Rich per-(model,string) intent for config upload; superset of `ports`. */
    modelIntents?: ControllerModelIntent[];
    /** Outputs (universes/channel blocks) from xlights_networks.xml. */
    outputs?: ControllerOutputIntent[];
    /** Provenance of the record. */
    source: 'xlights' | 'ezp' | 'both';
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
    /** Override active state (Enable / Disable). */
    active?: boolean;
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
    notes?: string;
}

/** A partial edit merged into a record by the `record` command (create if absent). */
export type EzpControllerRecordPatch = Partial<Omit<EzpControllerRecord, 'name'>>;

/**
 * How a grid row relates our known records to the live scan:
 *  - `present`      a known record we also found on the network
 *  - `absent`       a known record we did NOT find
 *  - `unregistered` a network find matching no record (a "ghost")
 */
export type ControllerRecordState = 'present' | 'absent' | 'unregistered';

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
    active?: boolean;
    /** Three-way enable state (`active` is its boolean collapse). */
    enableState?: ControllerEnableState;
    source?: KnownController['source'];
    /** xLights per-port intent, reconciled against the device's `pixelPorts`. */
    intent?: ControllerPortIntent[];
    /** Rich per-(model,string) intent; superset of `intent`. */
    modelIntents?: ControllerModelIntent[];
    /** xLights output/universe intent, reconciled against the device's `inputs`. */
    outputs?: ControllerOutputIntent[];
    /** Live health overlaid from the playback pipeline, joined by address/name. */
    health?: ControllerHealth;
}

/** Live per-controller health from the playback/status pipeline — the runtime
 *  signals a static xLights read + one-shot scan don't provide. */
export interface ControllerHealth {
    /** Rolling ICMP ping result. */
    connectivity?: 'Up' | 'Down' | 'Pending' | 'N/A';
    /** e.g. "8 out of 10 pings". */
    pingSummary?: string;
    /** Data-plane sender state: opened, config-skipped, connect-failed, or unusable. */
    status?: 'open' | 'skipped' | 'error' | 'unusable';
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
    /** Pixel protocol declared for the port, when present. */
    protocol?: string;
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
}

/** Per-port outcome:
 *  - `ok`         intent and actual agree
 *  - `missing`    xLights expects pixels here but the controller has none → reconfig
 *  - `unexpected` the controller has pixels here but xLights assigns none → stale/extra
 *  - `count`      both present but the pixel counts differ */
export type PortDriftKind = 'ok' | 'missing' | 'unexpected' | 'count';

/** One port's intent-vs-actual reconciliation. */
export interface PortReconcile {
    port: number;
    /** Bare intended model names on this port (the comparison set). */
    intendedModels: string[];
    /** Display labels parallel to `intendedModels`. */
    intendedModelLabels?: string[];
    intendedPixels?: number;
    /** Joined device model string — back-compat display value. */
    actualModel?: string;
    /** Per-model device names, when the device reports any. */
    actualModels?: string[];
    actualPixels?: number;
    /** Model-set comparison (case-insensitive match, case-preserving values).
     *  Absent when the device reports no model names at all. */
    missingModels?: string[];
    /** Device-reported models xLights assigns elsewhere (or nowhere). */
    extraModels?: string[];
    drift: PortDriftKind;
}
