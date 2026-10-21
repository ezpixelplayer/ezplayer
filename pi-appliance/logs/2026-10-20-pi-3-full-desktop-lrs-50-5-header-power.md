# Pi 3 — full desktop image — LRS-50-5 header power baseline

Recorded on 2026-10-20 after changing only the power source from USB power to
an LRS-50-5 supply connected to the Pi's 5 V header power rail. The board, SD
card, operating system, player build, network, and observed workload remained
the same as the USB-powered baseline.

## Test identity

- Label: Pi 3 — full desktop image — LRS-50-5 header power
- Board reported previously by `/proc/device-tree/model`: Raspberry Pi 3 Model B Rev 1.2
- Installed memory: 905 MiB usable
- OS: Debian GNU/Linux 13 (Trixie), full graphical image
- Kernel: `6.18.50+rpt-rpi-v8`
- Architecture: ARM64
- Boot target: `graphical.target`
- Display manager: active
- Player package: `0.6.11-pi.1`
- Sample: 60 target one-second intervals beginning at exactly 600 seconds uptime
- Power source: LRS-50-5 connected to the 5 V header power rail

The player UI was available during the sample. Four login sessions and one
`htop` process were active, matching the observed test state of the USB-powered
baseline as closely as practical.

## Results

| Measurement | Average | 95th percentile | Maximum/final |
| --- | ---: | ---: | ---: |
| Total CPU use | 55.1% | 81.6% | 86.4% |
| Used RAM | 843.7 MiB (93.2%) | 860.1 MiB | — |
| Used swap | 903.9 MiB | — | 905.0 MiB |
| 1-minute load | 7.78 during sample | — | 16.09 at sample end |
| CPU temperature | 75.2°C | — | 77.4°C |
| ARM clock | 1200.0 MHz | — | 1200.0 MHz |

EZPlayer's eight Electron processes had approximately 306.9 MiB of summed RSS
in the follow-up snapshot. This sum includes shared pages and is not equivalent
to unique physical memory.

The raw sample summary was:

```json
{
  "sample_seconds": 60,
  "uptime_at_start_seconds": 600,
  "cpu_percent": {"avg": 55.1, "median": 62.5, "p95": 81.6, "max": 86.4},
  "ram": {"total_mib": 905.0, "used_avg_mib": 843.7, "used_p95_mib": 860.1, "used_avg_percent": 93.2},
  "swap": {"total_mib": 905.0, "used_avg_mib": 903.9, "used_max_mib": 905.0},
  "load_1m": {"avg_during_sample": 7.78, "last": 16.09},
  "temperature_c": {"avg": 75.2, "max": 77.4},
  "arm_clock_mhz": {"avg": 1200.0, "min": 1200.0, "max": 1200.0},
  "throttling_values": ["throttled=0x0"]
}
```

## Power and throttling

`vcgencmd get_throttled` returned `throttled=0x0` before the sample and during
every sample interval. The ARM clock remained at 1200 MHz for the full sample.
The LRS-50-5 therefore removed the active undervoltage and power-throttling
condition observed with USB power.

Temperature was approximately 12°C higher because the CPU could remain at full
clock under load. No thermal-throttling flag appeared, but cooling should be
checked before long-duration tests.

## Memory and storage pressure

A ten-second `vmstat 1 10` follow-up showed the same fundamental limitation as
the USB test:

- Swap remained fully allocated at approximately 905 MiB.
- Swap-in and swap-out traffic continued throughout the sample.
- Between 12 and 19 processes were blocked on interval samples.
- IO wait ranged from 35% to 75% and was 60% or higher in seven of nine interval samples.

Raw `vmstat` interval values:

```text
 r  b   swpd   free   si   so    bi    bo  us sy id wa
 3 16 926684  46944 2440 2808 23952  2808  37 22  5 35
 1 16 926516  48244  748  704 23152   704  19 14  8 60
 1 15 926628  46304  188  356 20760   408   5 10 14 71
 0 18 926716  48792  180  580 22776   580   3  9 16 72
 1 15 920440  46780 1216 3896 20356  3896   5 13  7 75
 0 19 926632  52912 1776 8204 21552  8204  19 20  7 54
 0 12 926648  55344 1148 1196 19320  1196   4 10 20 66
 0 13 926704  54828 2972 3216 21772  3216   7 13 16 63
 0 15 926648  54676  368  296 20040   328   3  9 12 75
```

## Comparison with USB power

| Measurement | USB power | LRS-50-5 header power | Change |
| --- | ---: | ---: | ---: |
| CPU average | 71.3% | 55.1% | 16.2 points lower |
| CPU 95th percentile | 96.3% | 81.6% | 14.7 points lower |
| ARM clock snapshot/sample | 600 MHz | 1200 MHz throughout | Full clock restored |
| Throttling | `0x50005` | `0x0` | Power fault cleared |
| RAM average | 822.5 MiB | 843.7 MiB | 21.2 MiB higher |
| Swap average | 901.2 MiB | 903.9 MiB | Effectively unchanged/full |
| Temperature average | 63.0°C | 75.2°C | 12.2°C higher |

The regulated supply materially improved CPU operation, but it did not resolve
the full desktop image's memory exhaustion and storage thrashing. The next useful
comparison is the Raspberry Pi OS Lite image using the same LRS-50-5 supply.
