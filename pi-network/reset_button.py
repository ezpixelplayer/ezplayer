#!/usr/bin/env python3
"""Optional normally-open momentary button: BCM17 (pin 11) to GND (pin 9)."""
import subprocess
from signal import pause
from gpiozero import Button
from gpiozero.pins.lgpio import LGPIOFactory
# Uses the installed gpiozero board detection for Pi 4/Pi 5 gpiochip selection.
button=Button(17,pull_up=True,bounce_time=0.1,hold_time=10,hold_repeat=False,pin_factory=LGPIOFactory())
def reset():
    subprocess.run(['/usr/bin/python3','/opt/ezplayer-network/network_service.py','--reset-hotspot'],check=True)
button.when_held=reset
pause()
