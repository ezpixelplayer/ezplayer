# Pi 3 — Lite memory-corrected image — overnight soak

Recorded on 2026-10-21 after the memory-corrected Raspberry Pi OS Lite image had
run continuously for 21 hours 38 minutes. This is a separate follow-up to the
[initial corrected-image benchmark](2026-10-20-pi-3-lite-memory-corrected-lrs-50-5-header-power.md).

## Test identity

- Label: Pi 3 — Raspberry Pi OS Lite memory-corrected image — overnight soak
- Board: Raspberry Pi 3 Model B Rev 1.2
- Installed memory: 905 MiB usable
- OS: Debian GNU/Linux 13 (Trixie), Raspberry Pi OS Lite ARM64
- Kernel: `6.18.50+rpt-rpi-v8`
- Player package: `0.6.11~pi.1`
- Image SHA-256: `b5cbfe778c03f61d3625e414e2f541a2eed91fb12748e4d8227f45b1ef039806`
- Uptime before sampling: 21 hours 38 minutes
- Sample: 300 one-second intervals beginning at 77,943.4 seconds uptime
- Power source: LRS-50-5 connected to the 5 V header power rail

The player was actively playing. The headless player, network, show-output,
hotspot gateway, and nginx services were active before and after sampling. There
were no failed system or user units.

## Five-minute results

| Measurement | Average | 95th percentile | Maximum/final |
| --- | ---: | ---: | ---: |
| Total CPU use | 31.8% | 44.5% | 63.9% maximum |
| Used RAM | 692.7 MiB | 741.3 MiB | 747.9 MiB maximum; 712.9 MiB final |
| Used swap | 217.0 MiB | 217.0 MiB | 217.0 MiB maximum and final |
| IO wait | 0.0% | 0.3% | 1.8% maximum |
| 1-minute load | 1.7 | 2.5 | 2.6 maximum; 2.0 final |
| CPU temperature | 69.9°C | 70.9°C | 72.0°C maximum |
| ARM clock | 1194.3 MHz | 1200.0 MHz | 800.0–1200.0 MHz |
| Blocked processes | — | — | 0 maximum |

Swap stayed exactly 217.0 MiB at every one-second observation. Maximum swap-in
was 8 KiB/s and no swap-out occurred. This indicates that the higher overnight
swap allocation contained cold pages left by the kernel rather than active swap
thrashing or continuing memory exhaustion.

The seven Electron processes averaged 538.6 MiB summed RSS, ranged from 478.1 to
598.1 MiB, and ended at 557.2 MiB. Their summed swap stayed exactly 171.5 MiB.
Summed RSS includes shared pages and is useful for trends rather than unique-memory
accounting.

## Memory checkpoints

| Sample time | RAM used | Swap used | Electron RSS | Electron swap |
| ---: | ---: | ---: | ---: | ---: |
| 1 s | 741.3 MiB | 217.0 MiB | 575.7 MiB | 171.5 MiB |
| 30 s | 676.0 MiB | 217.0 MiB | 521.5 MiB | 171.5 MiB |
| 60 s | 647.0 MiB | 217.0 MiB | 494.9 MiB | 171.5 MiB |
| 120 s | 675.7 MiB | 217.0 MiB | 520.5 MiB | 171.5 MiB |
| 150 s | 746.5 MiB | 217.0 MiB | 596.7 MiB | 171.5 MiB |
| 180 s | 691.0 MiB | 217.0 MiB | 536.1 MiB | 171.5 MiB |
| 240 s | 732.6 MiB | 217.0 MiB | 579.0 MiB | 171.5 MiB |
| 300 s | 712.9 MiB | 217.0 MiB | 557.2 MiB | 171.5 MiB |

RAM and Electron RSS continued to fall after playback peaks. There was no
monotonic growth during the five-minute window.

## Playback and cache deltas

The playback API was sampled across 311.6 seconds, including the system sample:

| Counter | Change |
| --- | ---: |
| Playback iterations | 12,480 |
| Sent frames | 12,472 |
| Missing frames | 0 |
| Missing headers | 0 |
| Timing-based skipped frames | 8 |
| Missing background frames | 0 |
| Frames skipped for too many outstanding sends | 0 |
| FSEQ cache reference misses | 0 |
| Completed FSEQ chunk requests | 4,160 |
| FSEQ errors | 0 |
| ZSTD decompression time | 3,852.5 ms |
| FSEQ file-read time | 17,579.8 ms |
| Completed audio decodes | 2 |
| Audio decode errors | 0 |
| Audio chunks skipped | 0 |

FSEQ memory stayed exactly 22,642,208 bytes and active chunk-cache use stayed
exactly 9,716,568 bytes. The audio cache ended with two ready tracks, zero pending
or errored tracks, and 450 seconds used from its 720-second budget.

## Missing-frame counter clarification

The playback API's cumulative `missedFramesCumulative` value was already 149 when
it was first inspected on 2026-10-20 at roughly 80,000 playback iterations. That
counter covers any output cycle without a usable frame or without a ready sender;
it does not specifically mean ZSTD decompression failed. It can therefore increase
during startup and output initialization.

The value did not increase during the two-minute FSEQ check on 2026-10-20. It was
still exactly 149 at 3,112,141 iterations before this sample and remained 149 at
3,125,461 iterations afterward. The single cumulative missing-header count was
also unchanged. Because no per-frame trace was captured before the first API
query, the exact original event cannot be reconstructed. More than three million
subsequent iterations without another missing frame are consistent with an early
startup/output-initialization transient rather than an ongoing FSEQ throughput
problem.

## Comparison with the initial corrected-image run

| Measurement | Initial corrected run | Overnight follow-up |
| --- | ---: | ---: |
| Uptime before sample | 18.3 minutes | 21 hours 38 minutes |
| Sample duration | 10 minutes | 5 minutes |
| CPU average | 40.8% | 31.8% |
| RAM average | 718.0 MiB | 692.7 MiB |
| RAM maximum | 785.3 MiB | 747.9 MiB |
| Swap average | 135.3 MiB | 217.0 MiB, completely stable |
| Maximum swap-out | 8,096 KiB/s | 0 KiB/s |
| IO wait average | 0.1% | 0.0% |
| Electron RSS average | 685.1 MiB | 538.6 MiB |
| Temperature average | 73.9°C | 69.9°C |
| Throttling | `0x0` | `0x0` |

The additional swap allocation after nearly 22 hours was stable and accompanied
by lower resident memory, zero swap-out, zero blocked processes, and negligible IO
wait. The player did not return to the failure mode seen on the original Lite
image, where swap filled toward 905 MiB and sustained SD-card traffic caused
visible stuttering.

This overnight result supports the conclusion that the corrected caches, buffer
pools, workers, and scheduler references remain bounded on the Pi 3 under this
playlist.
