# Pi 3 — full desktop image — USB power baseline

Recorded on 2026-10-20 from the old Raspberry Pi OS full desktop image before changing the
power connection or installing the Raspberry Pi OS Lite image.

## Test identity

- Label: Pi 3 — full desktop image — USB power
- Board reported by `/proc/device-tree/model`: Raspberry Pi 3 Model B Rev 1.2
- Installed memory: 905 MiB usable
- OS: Debian GNU/Linux 13 (Trixie), full graphical image
- Kernel: `6.18.50+rpt-rpi-v8`
- Architecture: ARM64
- Boot target: `graphical.target`
- Display manager: active
- Player package: `0.6.11-pi.1`
- Sample duration: 60 one-second samples
- Uptime at sampling: approximately 10–12 minutes
- Power label supplied for this test: USB power

The player UI was available during the sample. Several SSH sessions and one
`htop` process were also active, so this represents the observed test state
rather than a clean synthetic idle measurement.

## Results

| Measurement | Average | 95th percentile | Maximum/final |
| --- | ---: | ---: | ---: |
| Total CPU use | 71.3% | 96.3% | 98.5% |
| Used RAM | 822.5 MiB (90.9%) | 836.8 MiB | 843 MiB in follow-up snapshot |
| Used swap | 901.2 MiB | — | 905 MiB |
| 1-minute load | 6.23 during sample | — | 8.11 at sample end; 16.31 later |
| CPU temperature | 63.0°C | — | 64.5°C |

EZPlayer's eight Electron processes had approximately 318.7 MiB of summed RSS
in the follow-up snapshot. This sum includes shared pages and is not equivalent
to unique physical memory.

The raw 60-second summary was:

```json
{
  "sample_seconds": 60,
  "cpu_percent": {"avg": 71.3, "median": 74.1, "p95": 96.3, "max": 98.5},
  "ram": {"total_mib": 905.0, "used_avg_mib": 822.5, "used_p95_mib": 836.8, "used_avg_percent": 90.9},
  "swap": {"total_mib": 905.0, "used_avg_mib": 901.2, "used_max_mib": 905.0},
  "load_1m": {"avg_during_sample": 6.23, "last": 8.11},
  "temperature_c": {"avg": 63.0, "max": 64.5},
  "throttling": "throttled=0x50005"
}
```

## Power and throttling

`vcgencmd get_throttled` reported:

```text
throttled=0x50005
```

This records current undervoltage and throttling as well as previous
undervoltage and throttling since boot. The ARM clock snapshot was approximately
600 MHz. Temperature remained moderate, so thermal limits were not the cause of
the reported throttling.

## Memory and storage pressure

A ten-second `vmstat 1 10` follow-up showed:

- Swap fully allocated at approximately 904 MiB.
- Continuous swap-in and intermittent swap-out activity.
- Between 10 and 22 processes blocked on most samples.
- IO wait between 64% and 79% on nine of the ten interval samples.

Raw `vmstat` interval values:

```text
 r  b   swpd   free   si   so    bi    bo  us sy id wa
 1 16 926712  70404 1636 1788 21208  1788   8 13  5 74
 0 16 926652  67968   56    0 20808     0   6 10 13 71
 0 22 926528  64712   72    0 20024     0   6 14  0 79
 1 12 926636  69844  148  212 19676   212   5 10 21 64
 2 10 926532  69896   32    0 18068     0   5 14 17 64
 2 12 926708  69932 1612 1784 19896  1784   7 12 15 66
 0 14 926564  69884  144    0 19160     0   3  8 14 75
 1 11 924244  63720 2656  328 20752   328  11 14  7 68
 0 15 926668  65540   96 2456 19288  2456   3 16 14 66
```

This is severe memory pressure and swap thrashing. It is consistent with the
observed lag, stuttering, and crashes. The graphical session included `labwc`,
`wf-panel-pi`, and `pcmanfm` in addition to Electron and the audio services.

## Comparison procedure

For a useful before/after comparison, repeat the same 60-second collection after
each individual change:

1. Pi 3, full desktop image, regulated 5 V header power.
2. Pi 3, Lite image, the same regulated 5 V header power.

Use the same Pi, SD card class, connected controllers, audio device, sequence,
and playback state. Wait at least ten minutes after boot before sampling. Record
`vcgencmd get_throttled` before interpreting CPU results; an active power warning
makes CPU comparisons unreliable.
