import type {
    CloudConfig,
    CloudPollScheduleEntry,
    CloudStatus,
    OutOfBandCommand,
    PlayerCStatusContent,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';

/** Tunables for the worker. Aggressive defaults are demo values; production
 *  callers will pass longer intervals to save cloud cost. */
export interface CloudWorkerTuning {
    /** Registration heartbeat poll cadence (ms). */
    registrationIntervalMs?: number;
    /** Manifest (sequence list) poll cadence (ms). */
    manifestIntervalMs?: number;
    /** Per-request timeout for downloads (ms). */
    downloadTimeoutMs?: number;
    /** Trip the circuit breaker after this many consecutive download failures. */
    failureThreshold?: number;
}

/** Parent → worker. */
export type CloudPollInMessage =
    | {
          type: 'setConfig';
          cloudUrl: string;
          playerIdToken: string;
          showFolder: string;
          /** Existing local sequences so the worker can diff against the manifest
           *  without re-reading them. Refreshed on each setConfig. */
          existingSequences: SequenceRecord[];
          /** Last-known layout file ids/times — drives the staleness check on layout
           *  fetch so we skip downloads for files that haven't changed. */
          layoutMeta?: CloudConfig['layoutMeta'];
          /** Whose layout this folder uses. In `'cloud'` mode the worker auto-fetches
           *  layout at the head of every manifest tick (cheap when nothing's stale). */
          layoutSource?: 'xlights' | 'cloud';
          /** Content polling: `'always'` runs on cadence; `'scheduled'` only fires
           *  when current local time matches a window in `pollSchedule`. Registration
           *  heartbeat ignores this gate. */
          pollMode?: 'always' | 'scheduled';
          pollSchedule?: CloudPollScheduleEntry[];
          tuning?: CloudWorkerTuning;
      }
    | { type: 'updateSequences'; existingSequences: SequenceRecord[] }
    | { type: 'pollNow' }
    | { type: 'manifestNow' }
    | { type: 'fetchLayoutNow' }
    | { type: 'uploadLayoutNow' }
    | { type: 'stop' };

/** Worker → parent. */
export type CloudPollOutMessage =
    | { type: 'cloudStatus'; status: CloudStatus }
    | { type: 'cStatus'; status: PlayerCStatusContent }
    | {
          /** A sequence has fully landed (all files staged + promoted into the show folder).
           *  Parent merges via the same path renderer-driven adds use. */
          type: 'installSequence';
          record: SequenceRecord;
          /** Show-folder-relative paths of files this sequence is replacing
           *  (so the parent / main can delete them after the merge). */
          superseded: string[];
      }
    | {
          /** Fired after a successful layout fetch (zip unpacked + XMLs overlaid).
           *  The receiver should treat this as equivalent to a fresh "set show folder"
           *  and reload everything that depends on layout (model coords, playback, ...). */
          type: 'layoutInstalled';
          /** Updated cloud meta — main persists this so future fetches can short-circuit
           *  when nothing has changed. */
          layoutMeta: NonNullable<CloudConfig['layoutMeta']>;
      }
    | {
          /** Out-of-band commands the cloud emitted in the latest checkin response.
           *  These are bridge-lifecycle controls (currently `openCloudWS` /
           *  `closeCloudWS`); the parent owns session tracking and dispatch to
           *  the server worker that actually dials the bridge. */
          type: 'outOfBandCommands';
          commands: OutOfBandCommand[];
      }
    | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string };
