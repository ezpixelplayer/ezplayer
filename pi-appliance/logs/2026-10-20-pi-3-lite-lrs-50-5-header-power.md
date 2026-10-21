# Pi 3 — Lite image — LRS-50-5 header power baseline

Recorded on 2026-10-20 after flashing the first corrected Raspberry Pi OS Lite
image, completing setup, and rebooting. The Pi used the same LRS-50-5 supply
connected to its 5 V header as the regulated-power desktop baseline.

## Test identity

- Label: Pi 3 — Raspberry Pi OS Lite image — LRS-50-5 header power
- Board reported by `/proc/device-tree/model`: Raspberry Pi 3 Model B Rev 1.2
- Installed memory: 905 MiB usable
- OS: Debian GNU/Linux 13 (Trixie), Raspberry Pi OS Lite image
- Kernel: `6.18.50+rpt-rpi-v8`
- Architecture: ARM64
- Boot target reported: `graphical.target`, with no desktop environment or display manager installed
- Player package: `0.6.11~pi.1`
- Image SHA-256: `bc3cb7f31f879fc0ff8462987b9372a75ddf8d8d0792a3429aff55fabb133374`
- Sample: 60 one-second intervals beginning at 603.4 seconds uptime
- Power source: LRS-50-5 connected to the 5 V header power rail

The headless player user service was active, and `http://192.168.254.183:3000/player`
returned HTTP 200 before sampling. `ezplayer-network`, `ezplayer-show-output`, and
nginx were active throughout the sample.

## Results

| Measurement | Average | 95th percentile | Maximum/final |
| --- | ---: | ---: | ---: |
| Total CPU use | 48.2% | 68.5% | 79.1% |
| Used RAM | 792.5 MiB (87.6%) | 833.0 MiB | 831.2 MiB |
| Used swap | 642.3 MiB | — | 694.7 MiB maximum; 580.3 MiB final |
| 1-minute load | 2.16 during sample | — | 2.37 at sample end |
| CPU temperature | 71.4°C | — | 73.1°C |
| ARM clock | 1200.0 MHz | — | 1200.1 MHz |

EZPlayer's eight Electron processes had approximately 546.5 MiB of summed RSS
after the sample. This sum includes shared pages and is not equivalent to unique
physical memory. The primary headless Electron process reported approximately
430 MiB RSS in the follow-up snapshot.

The raw sample summary was:

```json
{
  "sample_seconds": 60,
  "uptime_start_seconds": 603.4,
  "uptime_end_seconds": 664.6,
  "cpu_percent": {"avg": 48.2, "median": 41.8, "p95": 68.5, "max": 79.1},
  "ram": {"total_mib": 905.0, "used_avg_mib": 792.5, "used_p95_mib": 833.0, "used_avg_percent": 87.6, "used_final_mib": 831.2},
  "swap": {"total_mib": 905.0, "used_avg_mib": 642.3, "used_max_mib": 694.7, "used_final_mib": 580.3},
  "load_1m": {"avg_during_sample": 2.16, "last": 2.37},
  "temperature_c": {"avg": 71.4, "max": 73.1},
  "throttling_values": ["throttled=0x0"],
  "arm_clock_mhz": {"avg": 1200.0, "min": 1200.0, "max": 1200.1},
  "electron": {"process_count": 8, "summed_rss_mib": 546.5}
}
```

## Power and throttling

`vcgencmd get_throttled` returned `throttled=0x0` before the sample, during every
sample interval, and afterward. The ARM clock remained at approximately 1200 MHz.
The regulated supply continued to provide stable power without throttling.

## Memory and storage pressure

The Lite image reduced swap allocation and eliminated the severe blocked-process
and IO-wait behavior seen on the desktop image. It still used more memory than
expected for a headless Pi 3 appliance.

The ten-second `vmstat 1 10` follow-up showed:

- Swap allocation fell gradually from approximately 592 MiB to 589 MiB.
- Swap-in continued at roughly 296–412 KiB/s on the interval samples, but no
  swap-out occurred.
- No processes were blocked during any interval.
- IO wait remained at 0% on the interval samples.

Raw `vmstat` values:

```text
 r  b   swpd   free buff cache  si   so   bi bo    in   cs us sy id wa
 2  0 606608  50560  292 82320 700 1381 1940 1392 15584   11 37 12 50  1
 2  0 606248  49224  292 82932 360    0  892    0 16280 4846 32 10 58  0
 2  0 605836  56464  300 83460 412    0  892   16 16536 5159 36 13 52  0
 1  0 605428  44540  300 83844 400    0  708    0 16004 4736 45 14 40  0
 1  0 605048  45304  300 84100 380    0  636    0 16207 4771 32 10 58  0
 1  0 604652  45304  300 84228 396    0  524   12 16032 4392 33  7 60  0
 1  0 604276  44548  300 84612 376    0  760    0 16318 4755 34  8 58  0
 2  0 603944  44420  300 84740 332    0  460    0 16154 4685 33  8 59  0
 3  0 603644  41352  308 84976 296    0  552   20 16227 4603 35  8 56  0
 1  0 603232  44908  308 85264 396    0  652    0 16315 5083 42 12 46  0
```

## Comparison with the full desktop image

| Measurement | Full desktop, LRS power | Lite, LRS power | Change |
| --- | ---: | ---: | ---: |
| CPU average | 55.1% | 48.2% | 6.9 points lower |
| CPU 95th percentile | 81.6% | 68.5% | 13.1 points lower |
| RAM average | 843.7 MiB | 792.5 MiB | 51.2 MiB lower |
| Swap average | 903.9 MiB | 642.3 MiB | 261.6 MiB lower |
| 1-minute load average | 7.78 | 2.16 | 5.62 lower |
| Temperature average | 75.2°C | 71.4°C | 3.8°C lower |
| Blocked processes | 12–19 | 0 | Cleared |
| IO wait | 35–75% | 0% | Cleared |
| Throttling | `0x0` | `0x0` | Stable in both tests |

The Lite image materially improved responsiveness-related measurements. It
removed storage thrashing and sharply reduced load, but the headless Electron
process still leaves little free RAM on a 1 GB Pi.

## Gateway issue observed during this test

`ezplayer-gateway.service` was restarting every five seconds during the sample;
its restart counter reached 115. The nftables parser rejected the chain name
`redirect` as a reserved keyword in `hotspot_gateway.py`. This adds some background
process-start overhead and means the restricted hotspot HTTPS gateway was not
available. The captive setup portal, player, show output, and nginx services were
otherwise active. A corrected-image retest should be used for the final baseline.

## Second sample during visible stuttering

A second 60-second sample started at 780.8 seconds uptime when visible stuttering
increased. No reboot or configuration change occurred between samples.

| Measurement | First sample | Stuttering sample | Change |
| --- | ---: | ---: | ---: |
| Total CPU average | 48.2% | 43.9% | 4.3 points lower |
| CPU 95th percentile | 68.5% | 58.0% | 10.5 points lower |
| Used RAM average | 792.5 MiB | 824.0 MiB | 31.5 MiB higher |
| Used RAM 95th percentile | 833.0 MiB | 844.5 MiB | 11.5 MiB higher |
| Used swap average | 642.3 MiB | 763.9 MiB | 121.6 MiB higher |
| Used swap maximum | 694.7 MiB | 793.8 MiB | 99.1 MiB higher |
| 1-minute load average | 2.16 | 2.77 | 0.61 higher |
| Temperature average | 71.4°C | 72.3°C | 0.9°C higher |

The raw stuttering sample was:

```json
{
  "sample_seconds": 60,
  "uptime_start_seconds": 780.8,
  "uptime_end_seconds": 841.8,
  "cpu_percent": {"avg": 43.9, "median": 41.9, "p95": 58.0, "max": 65.0},
  "ram": {"total_mib": 905.0, "used_avg_mib": 824.0, "used_p95_mib": 844.5, "used_avg_percent": 91.0, "used_final_mib": 846.9},
  "swap": {"total_mib": 905.0, "used_avg_mib": 763.9, "used_max_mib": 793.8, "used_final_mib": 741.7},
  "load_1m": {"avg_during_sample": 2.77, "last": 2.23},
  "temperature_c": {"avg": 72.3, "max": 73.1},
  "throttling_values": ["throttled=0x0"],
  "arm_clock_mhz": {"avg": 1200.0, "min": 1200.0, "max": 1200.0},
  "electron": {"process_count": 8, "summed_rss_mib": 392.8}
}
```

The immediate follow-up showed swap rising to approximately 905 MiB. Interval
swap-out peaked at 36,508 KiB/s, three processes became blocked, and IO wait rose
to 14%. The main Electron process then reported about 213 MiB resident and 720 MiB
swapped. Its smaller resident set in this snapshot reflects eviction to swap rather
than reduced memory demand.

The stuttering therefore correlates directly with the headless Electron process
exhausting physical memory and forcing heavy SD-card swap traffic. CPU saturation,
temperature, undervoltage, and clock throttling were not the limiting factors in
this sample.

## Memory-retention audit and correction

The first Lite image still used desktop-class playback memory defaults. Several
independent allocations accumulated or retained their high-water mark:

- Decoded audio stayed cacheable for 25 hours and the 1 GB profile allowed about
  350 MiB of decoded stereo PCM.
- The MP3 decoder reserved up to 15 minutes of stereo PCM per decode, retained up
  to 512 MB of returned buffers, and permanently kept a 32 MB or larger compressed
  file scratch buffer.
- The FSEQ cache had a byte budget, but evicted decompressed buffers were returned
  to an uncapped recycler. Its reported cache usage could fall while process RSS
  remained high. Four concurrent FSEQ decodes and four persistent WebAssembly ZSTD
  workers also raised the transient and retained footprint.
- Expired, prevented schedule entries were removed from the scheduling heap but
  remained referenced by its lookup map.

The corrected 1 GB profile uses these limits:

| Allocation | Corrected limit/behavior |
| --- | --- |
| Decoded audio cache | 720 seconds; stale tracks expire after 5 seconds |
| Returned decoded-audio buffers | 16 MB |
| Compressed-audio scratch retention | 16 MB; larger scratch buffers are released after decode |
| Active decompressed FSEQ cache | 64 MB; stale chunks expire after 5 seconds |
| Returned FSEQ buffers | 16 MB |
| FSEQ/ZSTD concurrency | One persistent worker and one concurrent decode |
| 3D viewer response recycler | 16 MB |

One currently required song or FSEQ block may exceed its normal cache budget so
long media continues to play; it is released after it is no longer active. Small
per-song/request bookkeeping maps now discard completed entries, and expired
scheduler entries are removed from both heap indexes.

These corrections passed the EPP, scheduler, and Electron test suites plus the
production main-process build. The measurements above describe the original Lite
image and must not be treated as the corrected result.

The corrected-image measurements are recorded separately in
[Pi 3 — Lite memory-corrected image — LRS-50-5 header power](2026-10-20-pi-3-lite-memory-corrected-lrs-50-5-header-power.md).
