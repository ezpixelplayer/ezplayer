# Pi 3 — Lite memory-corrected image — LRS-50-5 header power

Recorded on 2026-10-20 after flashing the Raspberry Pi OS Lite image containing
the playback memory-retention corrections, completing setup, rebooting, and
allowing the playlist to run for 15 minutes before measurement.

Compare this run with the
[first Lite-image run](2026-10-20-pi-3-lite-lrs-50-5-header-power.md), which used
the original playback memory settings and developed visible stuttering as RAM and
swap filled.

## Test identity

- Label: Pi 3 — Raspberry Pi OS Lite memory-corrected image — LRS-50-5 header power
- Board: Raspberry Pi 3 Model B Rev 1.2
- Installed memory: 905 MiB usable
- OS: Debian GNU/Linux 13 (Trixie), Raspberry Pi OS Lite ARM64
- Kernel: `6.18.50+rpt-rpi-v8`
- Player package: `0.6.11~pi.1`
- Image SHA-256: `b5cbfe778c03f61d3625e414e2f541a2eed91fb12748e4d8227f45b1ef039806`
- Image size: 948,900,956 bytes compressed; 4,672,454,656 bytes uncompressed
- Warm-up: 15 minutes of normal playlist playback
- Sample: 600 one-second intervals beginning at 1,095.0 seconds uptime
- Power source: LRS-50-5 connected to the 5 V header power rail

The headless player, network, show-output, and hotspot gateway services were active.
No system or user services failed during the run. The corrected gateway chain and
`192.168.25.2` Ethernet default were installed.

## Memory profile under test

| Allocation | Pi 3 limit/behavior |
| --- | --- |
| Decoded audio cache | 720 seconds; inactive tracks expire after 5 seconds |
| Returned decoded-audio buffers | 16 MB |
| Compressed-audio scratch retention | 16 MB; larger buffers released after decode |
| Active decompressed FSEQ cache | 64 MB; inactive chunks expire after 5 seconds |
| Returned FSEQ buffers | 16 MB |
| FSEQ/ZSTD concurrency | One concurrent decode and one persistent worker |
| 3D viewer response recycler | 16 MB |

One currently required song or FSEQ block may exceed its cache budget so unusually
large media still plays. It is released after it is no longer active.

## Results

| Measurement | Average | 95th percentile | Maximum/final |
| --- | ---: | ---: | ---: |
| Total CPU use | 40.8% | 63.2% | 71.1% maximum |
| Used RAM | 718.0 MiB | 775.4 MiB | 785.3 MiB maximum; 732.6 MiB final |
| Used swap | 135.3 MiB | — | 149.4 MiB maximum; 133.1 MiB final |
| IO wait | 0.1% | — | 4.0% maximum |
| 1-minute load | 1.82 during sample | — | 1.92 at sample end |
| CPU temperature | 73.9°C | — | 77.4°C maximum |
| ARM clock | 1195.7 MHz | — | 800.0–1200.0 MHz |
| Blocked processes | — | — | 1 maximum |

Electron had seven processes at the end of the sample. Summed Electron RSS averaged
685.1 MiB, ranged from 600.5 to 754.2 MiB, and ended at 706.7 MiB. Summed RSS
includes shared pages and is not equivalent to unique physical memory. Electron
swap averaged 97.5 MiB, peaked at 109.5 MiB, and ended at 93.7 MiB.

## Memory checkpoints

RAM and Electron RSS moved up and down with playback rather than increasing
continuously:

| Sample time | RAM used | Swap used | Electron RSS | Electron swap |
| ---: | ---: | ---: | ---: | ---: |
| 1 s | 705.7 MiB | 116.4 MiB | 637.0 MiB | 88.0 MiB |
| 90 s | 784.2 MiB | 132.0 MiB | 744.0 MiB | 101.9 MiB |
| 150 s | 662.3 MiB | 148.0 MiB | 627.8 MiB | 108.5 MiB |
| 300 s | 728.0 MiB | 136.1 MiB | 696.2 MiB | 96.6 MiB |
| 360 s | 645.2 MiB | 135.6 MiB | 613.7 MiB | 96.1 MiB |
| 450 s | 764.7 MiB | 133.2 MiB | 734.4 MiB | 93.8 MiB |
| 510 s | 670.4 MiB | 133.2 MiB | 645.0 MiB | 93.8 MiB |
| 600 s | 732.6 MiB | 133.1 MiB | 706.7 MiB | 93.7 MiB |

Electron RSS repeatedly fell by roughly 55–130 MiB after peaks, evidence that
inactive playback data was released. Swap rose early to 149.4 MiB, then declined
and stayed near 133 MiB for the final several minutes rather than filling
continuously.

## Comparison with the original Lite image

| Measurement | Original Lite sample | Original stuttering sample | Memory-corrected sample |
| --- | ---: | ---: | ---: |
| Sample duration | 60 seconds | 60 seconds | 600 seconds |
| CPU average | 48.2% | 43.9% | 40.8% |
| RAM average | 792.5 MiB | 824.0 MiB | 718.0 MiB |
| RAM maximum/final | 831.2 MiB final | 846.9 MiB final | 785.3 MiB maximum |
| Swap average | 642.3 MiB | 763.9 MiB | 135.3 MiB |
| Swap maximum | 694.7 MiB | 793.8 MiB, then about 905 MiB | 149.4 MiB |
| Maximum sampled swap-out | — | 36,508 KiB/s | 8,096 KiB/s |
| IO wait | 0% follow-up | reached 14% | 0.1% average; 4.0% maximum |
| Blocked processes | 0 follow-up | 3 follow-up | 1 maximum |
| Temperature average | 71.4°C | 72.3°C | 73.9°C |
| Throttling | `0x0` | `0x0` | `0x0` |

The original image showed monotonic RAM and swap growth followed by sustained SD
card swap traffic and visible stuttering. The corrected run showed repeated memory
release, stable swap, and negligible average IO wait. No memory errors,
`FrameReference` leak warnings, worker-exhaustion errors, or failed services were
found after the corrected sample.

This run demonstrates the corrections working over a 15-minute warm-up and
10-minute measured window. A multi-hour or overnight soak remains useful for
detecting slower accumulation.

## FSEQ concurrency check

A separate two-minute live playback delta was collected after the memory test to
determine whether the one-worker Pi 3 profile was limiting FSEQ delivery:

| Counter | Two-minute change |
| --- | ---: |
| Sent frames | 4,792 |
| Missing FSEQ frames | 0 |
| Missing FSEQ headers | 0 |
| FSEQ cache reference misses | 0 |
| Completed FSEQ chunk requests | 1,613 |
| ZSTD decompression time | 1,532.5 ms |
| FSEQ file-read time | 7,072.2 ms |
| Frames skipped because too many sends were outstanding | 0 |
| Other timing-based skipped frames | 8 |
| Audio chunks skipped | 0 |

FSEQ memory stayed stable at 21,560,864 bytes, while active chunk-cache use moved
only from 9,636,924 to 9,690,020 bytes of its 64 MB budget. One decoder therefore
had ample throughput for this playlist. File reads consumed roughly 4.6 times as
much time as decompression, and the eight skipped frames were not accompanied by
missing FSEQ data. Raising Pi 3 decode concurrency would add persistent WebAssembly
memory and CPU contention without addressing a measured FSEQ bottleneck in this
run.

The MP3 cache reported two ready tracks, zero pending/error/in-progress tracks,
and 515 seconds used from its 720-second budget. No audio chunks were skipped in
the two-minute delta. The older `Way too many audio iterations!` string remained
in the API's cumulative last-error field, which does not include a timestamp; the
unchanged audio-skip counter shows no associated audio loss during this interval.

The cumulative missing-frame value was 149 before this two-minute delta and did
not increase during it. Its source and overnight stability are documented in the
[October 21 overnight soak report](2026-10-21-pi-3-lite-memory-corrected-overnight-soak.md).
