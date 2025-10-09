import {
    type CombinedPlayerStatus,
    type EndUser,
    type EndUserShowSettings,
    type PlaylistRecord,
    type ScheduledPlaylist,
    type SequenceRecord,
} from '@ezplayer/ezplayer-core';

import { FSEQReaderAsync } from '@ezplayer/epp';

import * as path from 'path';
import fsp from 'fs/promises';

// sequences.json
interface TempSeqsAPIPayload {
    data: {
        allSongs?: SequenceRecord[];
    };
}

// playlists.json
interface TempPlaylistsPayload {
    data: {
        playlists?: PlaylistRecord[];
    };
}

// schedule.json
interface TempScheduleAPIPayload {
    data: {
        scheduledPlaylists?: ScheduledPlaylist[];
    };
}

// show.json
interface TempShowAPIPayload {
    data: {
        show?: EndUserShowSettings;
    };
}

// user.json
interface TempUserAPIPayload {
    data: {
        user?: EndUser;
    };
}

export const defaultSeqs: SequenceRecord[] = [
    {
        id: '0bc1f84b-a8ff-47d2-bd55-c902e257a9f2',
        instanceId: 'ezrgb_EZ-15873_Pro_s3d9mm',
        work: {
            title: 'Inferno of Scary Skeletons',
            artist: 'Titus Jones',
            length: 271,
            music_url:
                'https://remix.audio/track/25164/inferno-of-scary-skeletons-amp-bad-rats-andrew-gold-vs-britney-vs-olivia-rodrigo-vs-more',
            description:
                'Introducing the electrifying and bone-chilling Titus Jones Mashup: Inferno of Scary Skeletons xLights Halloween sequence! Get ready to transform your Halloween light display into a mesmerizing spectacle that will captivate and thrill your guests.',
            tags: ['mashup', 'pop'],
            genre: 'halloween',
            artwork:
                'https://www.pixelprodisplays.com/wp-content/uploads/2023/06/maxresdefault-1-e1688174241884-600x600.jpg',
        },
        sequence: {
            vendor: 'Pixel Pro Displays',
            variant: 'Pro',
            sku: 'EZ-15873',
            vendor_url: 'https://www.pixelprodisplays.com/product/titus-jones-mashup-inferno-of-scary-skeletons/',
            preview_url: 'https://www.youtube.com/watch?v=Qag3QbG4z_c',
        },
        files: {
            audio: 'Titus-Jones-Inferno-of-Scary-Skeletons_0824b6.mp3',
            fseq: 'Titus-Jones-Inferno-of-Scary-Skeletons_Pro_8je249.fseq',
        },
        settings: {
            volume_adj: 10,
            lead_time: 0.1,
            trail_time: -1.1,
        },
    },
    {
        id: 'e9effde4-2acb-41cd-8c8e-bfbda45e6238',
        instanceId: 'ezrgb_EZ-15873_Pro_s3d9mm',
        work: {
            title: 'Wrap Me Up (Pixel Pro Displays)',
            artist: 'Jimmy Fallon Ft Meghan Trainor',
            length: 149,
            music_url:
                'https://www.amazon.com/dp/B0CN2FY6QN?tag=pixelprodispl-20&linkCode=ogi&th=1&psc=1&language=en_US&currency=USD',
            description:
                'Get ready to light up your holidays with the joyful and upbeat spirit of Jimmy Fallon and Meghan Trainor’s “Wrap Me Up.” This dazzling light sequence brings their festive tune to life, filling your home with playful animations and synchronized lights that match the energy of the song.',
            tags: ['christmas', 'pop'],
            genre: 'christmas',
            artwork:
                'https://www.pixelprodisplays.com/wp-content/uploads/2023/06/maxresdefault-1-e1688174241884-600x600.jpg',
        },
        sequence: {
            vendor: 'Pixel Pro Displays',
            variant: 'Pro',
            sku: 'EZ-15875',
            vendor_url: 'https://www.pixelprodisplays.com/product/titus-jones-mashup-inferno-of-scary-skeletons/',
            preview_url: 'https://youtu.be/tgsU7_kYHgQ',
        },
        files: {
            audio: 'Titus-Jones-Inferno-of-Scary-Skeletons_0824b6.mp3',
            fseq: 'Titus-Jones-Inferno-of-Scary-Skeletons_Pro_8je249.fseq',
        },
        settings: {
            volume_adj: 10,
            lead_time: 0.1,
            trail_time: -1.1,
        },
    },
    {
        id: '331d0294-7547-47ec-8527-74adfc01e68c',
        instanceId: 'ezrgb_EZ-15873_Pro_s3d9mm',
        work: {
            title: 'Carol Of The Bells',
            artist: 'Lindsey Stirling',
            length: 169,
            music_url:
                'https://www.amazon.com/dp/B075FKRNQ9?tag=pixelprodispl-20&linkCode=ogi&th=1&psc=1&language=en_US&currency=USD',
            description:
                'Transform your holiday display with the stunning Lindsey Stirling’s “Carol of the Bells” light sequence, a mesmerizing blend of vibrant colors and synchronized light patterns. Set to Stirling’s powerful and iconic violin rendition, this sequence captures the energy and elegance of the holiday season, filling your home or yard with the magical spirit of Christmas.',
            tags: ['christmas', 'instrumental'],
            genre: 'christmas',
            artwork:
                'https://www.pixelprodisplays.com/wp-content/uploads/2023/06/maxresdefault-1-e1688174241884-600x600.jpg',
        },
        sequence: {
            vendor: 'Pixel Pro Displays',
            variant: 'Pro',
            sku: 'EZ-15873',
            vendor_url: 'https://www.pixelprodisplays.com/product/titus-jones-mashup-inferno-of-scary-skeletons/',
            preview_url: 'https://www.youtube.com/watch?v=Qag3QbG4z_c',
        },
        files: {
            audio: 'Titus-Jones-Inferno-of-Scary-Skeletons_0824b6.mp3',
            fseq: 'Titus-Jones-Inferno-of-Scary-Skeletons_Pro_8je249.fseq',
        },
        settings: {
            volume_adj: 10,
            lead_time: 0.1,
            trail_time: -1.1,
        },
    },
    {
        id: '624c6525-ae93-4001-b8ae-fddfbf1835d8',
        instanceId: 'ezrgb_EZ-15873_Pro_s3d9mm',
        work: {
            title: 'Monster Mash',
            artist: 'Bobby Pickett',
            length: 193,
            music_url:
                'https://www.amazon.com/dp/B000VRWV4U?tag=pixelprodispl-20&linkCode=ogi&th=1&psc=1&language=en_US&currency=USD',
            description:
                'Bring the ultimate Halloween classic to life with our Bobby Pickett – Monster Mash light sequence. This spooky yet fun-filled display transforms your outdoor space into a graveyard bash, featuring eerie lighting effects that perfectly sync with the iconic song.',
            tags: ['halloween', 'classic'],
            genre: 'halloween',
            artwork: 'https://ezrgb.com/wp-content/uploads/2024/10/512msUXWDLL._SL500_.jpg',
        },
        sequence: {
            vendor: 'Pixel Pro Displays',
            variant: 'Pro',
            sku: 'EZ-15873',
            vendor_url: 'https://www.pixelprodisplays.com/product/titus-jones-mashup-inferno-of-scary-skeletons/',
            preview_url: 'https://www.youtube.com/watch?v=Qag3QbG4z_c',
        },
        files: {
            audio: 'Titus-Jones-Inferno-of-Scary-Skeletons_0824b6.mp3',
            fseq: 'Titus-Jones-Inferno-of-Scary-Skeletons_Pro_8je249.fseq',
        },
        settings: {
            volume_adj: 10,
            lead_time: 0.1,
            trail_time: -1.1,
        },
    },
    {
        id: '88fe0988-c410-4ee4-a93f-c6d8f04bb180',
        instanceId: 'ezrgb_EZ-15873_Pro_s3d9mm',
        work: {
            title: 'Rockin Around The Christmas Tree',
            artist: 'Brenda Lee',
            length: 125,
            music_url: 'https://www.amazon.com/Rockin-Around-Christmas-Single-Version/dp/B001NCHCOQ',
            description:
                'Brighten up the holidays with the Brenda Lee – Rockin’ Around the Christmas Tree light sequence! This lively light show captures the spirit of a classic Christmas tune, creating a festive atmosphere that’s perfect for parties, gatherings, or neighborhood displays.',
            tags: ['seasonal', 'classic'],
            genre: 'christmas',
            artwork:
                'https://ezrgb.com/wp-content/uploads/2024/11/Album-Cover-Rockin-Around-The-Christmas-Tree_720x.jpg',
        },
        sequence: {
            vendor: 'EZSequence',
            variant: 'Pro',
            sku: 'EZ-15874',
            vendor_url: 'https://www.pixelprodisplays.com/product/titus-jones-mashup-inferno-of-scary-skeletons/',
            preview_url: 'https://www.youtube.com/watch?v=Qag3QbG4z_c',
        },
        files: {
            audio: 'Titus-Jones-Inferno-of-Scary-Skeletons_0824b6.mp3',
            fseq: 'Titus-Jones-Inferno-of-Scary-Skeletons_Pro_8je249.fseq',
        },
        settings: {
            volume_adj: 0,
            lead_time: 0,
            trail_time: 0,
        },
    },
    {
        id: '2846957c-a3b7-4315-ac52-69756a0fcf20',
        instanceId: 'ezrgb_EZ-15802_Pro_12cs4l',
        work: {
            title: 'Pumpkin Patch Spooktacular',
            artist: 'Twinkling Traditions',
            length: 90,
            description:
                'Introducing Pumpkin Patch Spooktacular, a mesmerizing static light sequence perfect for your after-hours Halloween display.',
            tags: ['halloween', 'static'],
            genre: 'static',
            artwork:
                'https://www.pixelprodisplays.com/wp-content/uploads/2024/09/Screenshot-2024-09-30-222423-768x354.png',
        },
        sequence: {
            vendor: 'Pixel Pro Displays',
            variant: 'Pro',
            sku: 'EZ-15802',
            vendor_url: 'https://www.pixelprodisplays.com/product/pumpkin-patch-spooktacular/',
            preview_url: 'https://youtu.be/y0lbvVZwRhI',
        },
        files: {
            fseq: 'Twinkling-Traditions-Pumpkin-Patch-Spooktacular_Pro_a2dr5d.fseq',
        },
        settings: {},
    },
    {
        instanceId: 'foo',
        id: 'e01b225c-59c9-4d6b-90cc-28b6b9acd2ec',
        work: {
            title: 'Public Service Announcement',
            artist: '',
            length: 30,
            description: 'Reminder to not block driveways.',
            tags: ['psa'],
            genre: 'psa',
            artwork: 'PSA.png',
        },
        sequence: {
            vendor: 'Me',
        },
        files: {
            fseq: 'PSA.fseq',
            audio: 'PSA.mp3',
        },
        settings: {},
    },
]; // Add initial sequence records if needed

export const defaultPlaylists: PlaylistRecord[] = [
    {
        id: '1', // Playlist ID
        title: 'Weekday',
        tags: ['christmas', 'show   '],
        items: [
            { id: 'e01b225c-59c9-4d6b-90cc-28b6b9acd2ec', sequence: 1 },
            { id: '88fe0988-c410-4ee4-a93f-c6d8f04bb180', sequence: 2 },
            { id: 'e9effde4-2acb-41cd-8c8e-bfbda45e6238', sequence: 3 },
            { id: '331d0294-7547-47ec-8527-74adfc01e68c', sequence: 4 },
        ],
        createdAt: Date.now(),
    },
    {
        id: '2', // Playlist ID
        title: 'Weekend',
        tags: ['christmas', 'show'],
        items: [
            { id: 'e01b225c-59c9-4d6b-90cc-28b6b9acd2ec', sequence: 1 },
            { id: '88fe0988-c410-4ee4-a93f-c6d8f04bb180', sequence: 2 },
            { id: '331d0294-7547-47ec-8527-74adfc01e68c', sequence: 3 },
        ],
        createdAt: Date.now(),
    },
    {
        id: '3', // Playlist ID
        title: 'Tree Lighting',
        tags: ['christmas', 'special'],
        items: [
            { id: 'e01b225c-59c9-4d6b-90cc-28b6b9acd2ec', sequence: 1 },
            { id: '88fe0988-c410-4ee4-a93f-c6d8f04bb180', sequence: 2 },
            { id: '331d0294-7547-47ec-8527-74adfc01e68c', sequence: 3 },
        ],
        createdAt: Date.now(),
    },
];

export const defaultSchedule: ScheduledPlaylist[] = [
    {
        id: '1',
        playlistId: '1',
        title: 'Weekday',
        date: new Date('2025-02-26 12:00:00').getTime(),
        fromTime: '16:00:00',
        toTime: '21:00:00',
        playlistTitle: 'Weekday',
        duration: 3600 * 7,
    },
    {
        id: '2',
        playlistId: '1',
        title: 'Weekday',
        date: new Date('2025-02-27 12:00:00').getTime(),
        fromTime: '16:00:00',
        toTime: '21:00:00',
        playlistTitle: 'Weekday',
        duration: 3600 * 7,
    },
    {
        id: '3',
        playlistId: '2',
        title: 'Weekend',
        date: new Date('2025-02-28 12:00:00').getTime(),
        fromTime: '16:00:00',
        toTime: '23:00:00',
        playlistTitle: 'Weekend',
        duration: 3600 * 9,
    },
    {
        id: '4',
        playlistId: '2',
        title: 'Weekend',
        date: new Date('2025-03-01 12:00:00').getTime(),
        fromTime: '16:00:00',
        toTime: '23:00:00',
        playlistTitle: 'Weekend',
        duration: 3600 * 9,
    },
    {
        id: '5',
        playlistId: '2',
        title: 'Weekend',
        date: new Date('2025-03-02 12:00:00').getTime(),
        fromTime: '16:00:00',
        toTime: '23:00:00',
        playlistTitle: 'Weekend',
        duration: 3600 * 9,
    },
    {
        id: '6',
        playlistId: '3',
        title: 'Tree Lighting',
        date: new Date('2025-02-26 12:00:00').getTime(),
        fromTime: '18:00:00',
        toTime: '18:30:00',
        playlistTitle: 'Tree Lighting',
        duration: 3600 * 9,
    },
];

export const defaultShowProfile: EndUserShowSettings = {
    show_name: 'Seasonal Songs Sound Superb',
    tune_to: '102.5',
    rot_y: 60,
    message: '',
    layout_dim: 'Auto',
    fps: 40,
    group_mode: 'Default',
    guess_layout: 'Build',
    user_id: 'aaa',
    updated: new Date().getTime(),
};

export const blankShowProfile: EndUserShowSettings = {
    show_name: '',
    tune_to: '',
    rot_y: 0,
    message: '',
    layout_dim: 'Auto',
    fps: 0,
    group_mode: 'Default',
    guess_layout: 'Build',
    user_id: '',
    updated: new Date().getTime(),
};

export const defaultUserProfile: EndUser = {
    user_id: 'aaa',
    email: 'aaa@aa.a',
    name_f: 'A',
    name_l: 'AA',
    name_nn: 'AAA',
    status: 'active',
    class: 'free',
    create_time: new Date().getTime(),
};

export const blankUserProfile: EndUser = {
    user_id: '',
    email: '',
    name_f: '',
    name_l: '',
    name_nn: '',
    status: 'unregistered',
    class: 'N/A',
    create_time: new Date().getTime(),
};

/**
 * Ensure path is absolute relative to a base directory.
 */
function ensureAbsolute(p: string, base: string): string {
    if (path.isAbsolute(p)) {
        return p;
    }
    return path.join(base, p);
}

/**
 * Get relative path of a file against a base directory.
 * If not under base, returns the absolute path unchanged.
 */
function toRelative(p: string, base: string): string {
    const rel = path.relative(base, p);
    // path.relative returns things like "..\.." if not inside base
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return p; // not relative to base, return as-is
    }
    return rel;
}

export async function loadSequencesAPI(folder: string): Promise<SequenceRecord[]> {
    try {
        const p: TempSeqsAPIPayload = await JSON.parse(
            await fsp.readFile(path.join(folder, 'sequences.json'), 'utf-8'),
        );
        const seqs = p?.data?.allSongs ?? [];
        for (const s of seqs) {
            if (s.files?.fseq) {
                s.files.fseq = ensureAbsolute(s.files.fseq, folder);
            }
            if (s.files?.audio) {
                s.files.audio = ensureAbsolute(s.files.audio, folder);
            }
            if (s.files?.thumb) {
                s.files.thumb = ensureAbsolute(s.files.thumb, folder);
            }
            if (s.files?.fseq && (!s.work.length || s.work.length > 10000)) {
                try {
                    const fhdr = await FSEQReaderAsync.readFSEQHeaderAsync(s.files.fseq);
                    s.work.length = (fhdr.frames * fhdr.msperframe) / 1000;
                } catch (e) {
                    if (s.work.length && s.work.length > 10000) s.work.length /= 1000;
                    console.log(e);
                }
            }
        }
        return seqs;
    } catch (e) {
        // Maybe no file yet...
        console.log(e);
        return []; //defaultSeqs;
    }
}

export async function saveSequencesAPI(folder: string, payload: SequenceRecord[]) {
    const npayload = JSON.parse(JSON.stringify(payload)) as SequenceRecord[];
    for (const s of npayload) {
        if (s.files?.fseq) {
            s.files.fseq = toRelative(s.files.fseq, folder);
        }
        if (s.files?.audio) {
            s.files.audio = toRelative(s.files.audio, folder);
        }
        if (s.files?.thumb) {
            s.files.thumb = toRelative(s.files.thumb, folder);
        }
    }
    const userData: TempSeqsAPIPayload = {
        data: {
            allSongs: npayload,
        },
    };
    await fsp.writeFile(path.join(folder, 'sequences.json'), JSON.stringify(userData, null, 4), 'utf-8');
}

export async function loadPlaylistsAPI(folder: string): Promise<PlaylistRecord[]> {
    try {
        const p: TempPlaylistsPayload = await JSON.parse(
            await fsp.readFile(path.join(folder, 'playlists.json'), 'utf-8'),
        );
        return p.data.playlists ?? [];
    } catch (e) {
        console.log(e);
        return []; // defaultPlaylists;
    }
}

export const savePlaylistsAPI = async (folder: string, payload: PlaylistRecord[]) => {
    const userData: TempPlaylistsPayload = {
        data: {
            playlists: payload,
        },
    };
    await fsp.writeFile(path.join(folder, 'playlists.json'), JSON.stringify(userData, null, 4), 'utf-8');
};

export async function loadScheduleAPI(folder: string) {
    try {
        const p: TempScheduleAPIPayload = await JSON.parse(
            await fsp.readFile(path.join(folder, 'schedule.json'), 'utf-8'),
        );
        return p.data.scheduledPlaylists ?? [];
    } catch (e) {
        console.log(e);
        return []; //defaultSchedule;
    }
}

export const saveScheduleAPI = async (folder: string, payload: ScheduledPlaylist[]) => {
    const userData: TempScheduleAPIPayload = {
        data: {
            scheduledPlaylists: payload,
        },
    };
    await fsp.writeFile(path.join(folder, 'schedule.json'), JSON.stringify(userData, null, 4), 'utf-8');
};

export async function loadShowProfileAPI(folder: string) {
    try {
        const p: TempShowAPIPayload = await JSON.parse(await fsp.readFile(path.join(folder, 'show.json'), 'utf-8'));
        return p.data.show ?? defaultShowProfile;
    } catch (e) {
        console.log(e);
        return blankShowProfile; // defaultShowProfile;
    }
}

export async function saveShowProfileAPI(folder: string, data: EndUserShowSettings) {
    const sData: TempShowAPIPayload = {
        data: { show: data },
    };
    await fsp.writeFile(path.join(folder, 'show.json'), JSON.stringify(sData, null, 4), 'utf-8');
}

export async function loadUserProfileAPI(folder: string) {
    try {
        const p: TempUserAPIPayload = await JSON.parse(await fsp.readFile(path.join(folder, 'user.json'), 'utf-8'));
        return p.data.user ?? defaultUserProfile;
    } catch (e) {
        console.log(e);
        return blankUserProfile; // defaultUserProfile;
    }
}

export async function saveUserProfileAPI(folder: string, data: EndUser) {
    const sData: TempUserAPIPayload = {
        data: { user: data },
    };
    await fsp.writeFile(path.join(folder, 'user.json'), JSON.stringify(sData, null, 4), 'utf-8');
}

export async function loadStatusAPI(): Promise<CombinedPlayerStatus> {
    return {
        player_updated: new Date().getTime(),
        player: {
            ptype: 'EZP', // FPP or EZP
            status: 'Playing',
            reported_time: new Date().getTime() - 1000,
            now_playing: 'Daytime Static',
            now_playing_until: new Date().getTime() + 1000000,
            upcoming: [{ title: 'Weeknight Show', at: new Date().getTime() + 1000000 }],
            // versions, system status, storage, memory, temp, etc?
        },
        content_updated: new Date().getTime() - 10000,
        content: {
            n_sequences: 12,
            n_needing_download: 2,
            sequence_sync_time: new Date().getTime() - 5000,
            n_playlists: 6,
            n_schedules: 10,
            schedule_sync_time: new Date().getTime() - 5000,
        },
        controller_updated: new Date().getTime() - 5000,
        controller: {
            controllers: [
                {
                    name: 'House',
                    status: 'green',
                    reported_time: new Date().getTime() - 8000,
                },
                {
                    name: 'Yard',
                    status: 'green',
                    reported_time: new Date().getTime() - 8000,
                },
                {
                    name: 'Garage',
                    status: 'yellow',
                    reported_time: new Date().getTime() - 80000,
                },
            ],
            n_models: 354,
            n_channels: 764943,
        },
        show: {
            show_name: 'Winter Wonderland Drive',
        },
    };
}
