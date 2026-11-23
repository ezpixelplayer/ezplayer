#!/usr/bin/env python3
"""
EZPlayer audio listener: plays a player's audio buses on this computer's
sound card, each piece at the time the player stamped on it. Run it on a
computer next to a speaker (a Raspberry Pi, say) to make that speaker a place
the player can send sound to.

    python3 audio-bus-listen.py http://<player>:3000 [options]

    --name NAME      Name this listener is known by; default is the host name.
                     It appears under Audio Buses in the player's settings,
                     where buses are sent to it
    --bus NAME       Play this one bus, without registering as a listener
    --device DEV     ALSA device for aplay (see aplay -L); default is the
                     system default
    --delay MS       Time from handing a sample to the sound card until it is
                     heard; default 60. Raise it if the sound is late
    --player "CMD"   Command that plays raw PCM from its input instead of
                     aplay: 16-bit little-endian, 48 kHz, stereo
    --out FILE       Write the PCM to a file instead of playing it
    --seconds N      Stop after N seconds

It needs Python 3.7 or later and nothing else; sound goes out through aplay.

Give a bus enough lead to cover the network and --delay: 150 ms is a
comfortable start. Turn "Play on this computer" off for a bus that only
listeners should play. The show audio (main) is not served this way.

The sound card's clock is not the player's. While a bus is quiet this lets
the card run dry now and then so the two line up again; a bus that never
goes quiet for hours will drift.
"""

import argparse
import base64
import json
import os
import re
import shlex
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from array import array

RATE = 48000
TICK = 0.010
# Sound waiting for its time: four seconds of stereo, indexed by frame number on the player clock.
RING = RATE * 4
WIRE_MAGIC = 0x55415A45
CODEC_F32 = 0
CODEC_S16 = 3
RESYNC_EVERY = 60.0
RESYNC_PAUSE = 0.15


def parse_args():
    p = argparse.ArgumentParser(description='Play EZPlayer audio buses on this computer.')
    p.add_argument('player', nargs='?', default='http://localhost:3000')
    p.add_argument('--name')
    p.add_argument('--bus')
    p.add_argument('--device')
    p.add_argument('--delay', type=float, default=60.0)
    p.add_argument('--player', dest='player_cmd')
    p.add_argument('--out')
    p.add_argument('--seconds', type=float, default=0)
    return p.parse_args()


def clean_name(name):
    """A name the player accepts: letters, digits, spaces, _ . and -, 40 at most."""
    name = re.sub(r'[^A-Za-z0-9 _.-]', '-', name).lstrip(' _.-')[:40]
    return name or 'listener'


class Clock:
    """The player's clock, read against this computer's steady clock."""

    def __init__(self, base):
        self.base = base
        self.offset = 0.0
        self.trip = None

    def sync(self):
        best = None
        for _ in range(5):
            sent = time.monotonic() * 1000
            with urllib.request.urlopen(self.base + '/api/ezp/time', timeout=5) as r:
                now = json.load(r)['now']
            trip = time.monotonic() * 1000 - sent
            # The fastest answer is the one least delayed on the way.
            if best is None or trip < best:
                best = trip
                self.offset = now - (sent + trip / 2)
        self.trip = best
        return best

    def now(self):
        return time.monotonic() * 1000 + self.offset


def frame_at(ms):
    return int(round(ms * RATE / 1000))


class Mixer:
    """Holds sound until its time and hands it out in order, silence where there is none."""

    def __init__(self):
        self.ring = array('h', bytes(RING * 4))
        self.zeros = array('h', bytes(RING * 4))
        self.lock = threading.Lock()
        # First frame not yet handed to the output.
        self.cursor = 0
        self.pieces = 0
        self.late = 0
        self.spare_min = None
        self.spare_sum = 0.0

    def add(self, start, samples):
        """Place interleaved stereo samples whose first frame is frame `start`."""
        frames = len(samples) // 2
        with self.lock:
            skip = max(0, self.cursor - start)
            if skip:
                self.late += 1
            if skip >= frames or frames > RING // 2:
                return
            at = (start + skip) % RING
            src = samples[skip * 2:]
            first = min(frames - skip, RING - at)
            self._mix(at, src[: first * 2])
            if first < frames - skip:
                self._mix(0, src[first * 2:])

    def _mix(self, at, src):
        a, b = at * 2, at * 2 + len(src)
        if self.ring[a:b] == self.zeros[a:b]:
            self.ring[a:b] = src
            return
        # Another bus is already sounding here: add, without wrapping.
        ring = self.ring
        for i, v in enumerate(src):
            s = ring[a + i] + v
            ring[a + i] = 32767 if s > 32767 else -32768 if s < -32768 else s

    def take(self, target):
        """PCM bytes for the frames from the cursor up to `target`, and whether any of it sounds."""
        with self.lock:
            n = target - self.cursor
            if n <= 0:
                return b'', False
            at = self.cursor % RING
            first = min(n, RING - at)
            parts = [self.ring[at * 2:(at + first) * 2]]
            self.ring[at * 2:(at + first) * 2] = self.zeros[: first * 2]
            if first < n:
                parts.append(self.ring[: (n - first) * 2])
                self.ring[: (n - first) * 2] = self.zeros[: (n - first) * 2]
            self.cursor = target
        sounds = any(p != self.zeros[: len(p)] for p in parts)
        if sys.byteorder != 'little':
            for p in parts:
                p.byteswap()
        return b''.join(p.tobytes() for p in parts), sounds

    def skip_to(self, frame):
        """Move the cursor without playing what lies between."""
        with self.lock:
            n = frame - self.cursor
            if abs(n) >= RING:
                self.ring[:] = self.zeros
            elif n > 0:
                at = self.cursor % RING
                first = min(n, RING - at)
                self.ring[at * 2:(at + first) * 2] = self.zeros[: first * 2]
                self.ring[: (n - first) * 2] = self.zeros[: (n - first) * 2]
            self.cursor = frame

    def quiet_ahead(self, frames):
        """True when nothing is waiting in the next `frames` frames."""
        with self.lock:
            at = self.cursor % RING
            first = min(frames, RING - at)
            if self.ring[at * 2:(at + first) * 2] != self.zeros[: first * 2]:
                return False
            rest = frames - first
            return rest <= 0 or self.ring[: rest * 2] == self.zeros[: rest * 2]


class WebSocket:
    """Just enough of a WebSocket client to receive binary messages."""

    def __init__(self, url):
        u = urllib.parse.urlsplit(url)
        port = u.port or (443 if u.scheme == 'wss' else 80)
        self.sock = socket.create_connection((u.hostname, port), timeout=10)
        if u.scheme == 'wss':
            import ssl
            self.sock = ssl.create_default_context().wrap_socket(self.sock, server_hostname=u.hostname)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.send_lock = threading.Lock()
        self.buf = b''
        key = base64.b64encode(os.urandom(16)).decode()
        path = (u.path or '/') + ('?' + u.query if u.query else '')
        self.sock.sendall((
            'GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
            'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, u.hostname, port, key)
        ).encode())
        while b'\r\n\r\n' not in self.buf:
            self._fill()
        head, self.buf = self.buf.split(b'\r\n\r\n', 1)
        status = head.split(b'\r\n', 1)[0].decode('latin-1')
        if ' 101 ' not in status:
            raise ConnectionError('the player refused the connection: ' + status)
        # Quiet buses send nothing; our own pings bring pongs, so a long silence means a dead link.
        self.sock.settimeout(30)

    def _fill(self):
        data = self.sock.recv(65536)
        if not data:
            raise ConnectionError('connection closed')
        self.buf += data

    def _read(self, n):
        while len(self.buf) < n:
            self._fill()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, opcode, payload=b''):
        mask = os.urandom(4)
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        n = len(payload)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('>H', n))
        with self.send_lock:
            self.sock.sendall(head + mask + body)

    def recv(self):
        """The next binary or text message."""
        message = b''
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            opcode = b0 & 0x0F
            if opcode == 0x8:
                raise ConnectionError('the player closed the connection')
            if opcode == 0x9:
                self.send(0xA, payload)
            elif opcode in (0x0, 0x1, 0x2):
                message += payload
                if b0 & 0x80:
                    return message

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def on_frame(data, mixer, clock, delay):
    """One wire frame from the player (see AudioStreamWire.ts in ezplayer-core)."""
    if len(data) < 52:
        return
    magic, version, codec = struct.unpack_from('<IBB', data, 0)
    if magic != WIRE_MAGIC or version != 2:
        return
    play_at = struct.unpack_from('<d', data, 16)[0]
    rate, channels = struct.unpack_from('<IH', data, 32)
    frames = struct.unpack_from('<I', data, 40)[0]
    if rate != RATE or channels != 2:
        return
    if codec == CODEC_S16:
        samples = array('h', data[52:52 + frames * 4])
        if sys.byteorder != 'little':
            samples.byteswap()
    elif codec == CODEC_F32:
        floats = array('f', data[52:52 + frames * 8])
        if sys.byteorder != 'little':
            floats.byteswap()
        samples = array('h', (int(max(-1.0, min(1.0, v)) * 32767) for v in floats))
    else:
        return
    # Time to spare: how long before it had to be handed to the output it arrived.
    spare = play_at - delay - clock.now()
    mixer.pieces += 1
    mixer.spare_sum += spare
    mixer.spare_min = spare if mixer.spare_min is None else min(mixer.spare_min, spare)
    mixer.add(frame_at(play_at), samples)


def receive(url, mixer, clock, delay, stop):
    """Stay connected to the player, feeding the mixer."""
    said = ''
    while not stop.is_set():
        ws = None
        try:
            ws = WebSocket(url)
            print('connected to ' + url, flush=True)
            said = ''
            pinger_ws = ws

            def ping():
                while not stop.is_set() and pinger_ws.sock.fileno() >= 0:
                    try:
                        pinger_ws.send(0x9)
                    except OSError:
                        return
                    stop.wait(10)

            threading.Thread(target=ping, daemon=True).start()
            while not stop.is_set():
                on_frame(ws.recv(), mixer, clock, delay)
        except (OSError, ConnectionError) as e:
            if str(e) != said:
                said = str(e)
                print('not connected (%s); trying again' % e, flush=True)
        finally:
            if ws:
                ws.close()
        stop.wait(2)


def open_sink(args):
    """Where the PCM goes: a file, a player command, or nowhere."""
    if args.out:
        return open(args.out, 'wb'), None
    cmd = args.player_cmd
    if not cmd and sys.platform.startswith('linux'):
        cmd = 'aplay -q -t raw -f S16_LE -r 48000 -c 2 --buffer-time=40000 --period-time=10000'
        if args.device:
            cmd += ' -D ' + shlex.quote(args.device)
    if not cmd:
        print('no --player or --out given: counting what arrives without playing it', flush=True)
        return None, None
    child = subprocess.Popen(shlex.split(cmd), stdin=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)

    def errors():
        for line in child.stderr:
            text = line.decode('utf-8', 'replace').rstrip()
            # Running dry while quiet is how the card is lined up again.
            if text and 'underrun' not in text:
                print(text, file=sys.stderr, flush=True)

    threading.Thread(target=errors, daemon=True).start()
    return child.stdin, child


def main():
    args = parse_args()
    base = args.player.rstrip('/')
    if args.bus == 'main':
        sys.exit('the show audio (main) is not served this way; pick another bus')
    name = clean_name(args.name or socket.gethostname())
    query = {'bus': args.bus} if args.bus else {'listener': name}
    query['format'] = 's16'
    url = re.sub(r'^http', 'ws', base) + '/api/ezp/audiostream?' + urllib.parse.urlencode(query)

    clock = Clock(base)
    while True:
        try:
            trip = clock.sync()
            break
        except (OSError, ValueError, KeyError) as e:
            print('waiting for the player at %s (%s)' % (base, e), flush=True)
            time.sleep(3)
    print('clock: player is %.1f ms ahead of this computer (round trip %.1f ms)' % (
        clock.offset - (time.time() - time.monotonic()) * 1000, trip), flush=True)
    print('playing bus %s' % args.bus if args.bus else 'listener "%s": send buses to it under Audio Buses in the '
          'player settings' % name, flush=True)

    mixer = Mixer()
    stop = threading.Event()
    sink, child = open_sink(args)
    threading.Thread(target=receive, args=(url, mixer, clock, args.delay, stop), daemon=True).start()

    started = time.monotonic()
    last_sync = last_stats = last_resync = last_sound = started
    resync = sink is not None and child is not None
    try:
        while not stop.is_set():
            time.sleep(TICK)
            now = time.monotonic()
            target = frame_at(clock.now() + args.delay)
            behind = target - mixer.cursor
            if mixer.cursor == 0 or behind > RATE // 10 or behind < -RATE:
                # The start, a stall, or the clock moved: what was missed is not played late.
                mixer.skip_to(target - frame_at(TICK * 1000))
            pcm, sounds = mixer.take(target)
            if sounds:
                last_sound = now
            if sink and pcm:
                sink.write(pcm)
            if child and child.poll() is not None:
                sys.exit('the sound player ended (%s)' % child.returncode)
            if (resync and now - last_resync > RESYNC_EVERY and now - last_sound > 1.0
                    and mixer.quiet_ahead(frame_at((RESYNC_PAUSE + 0.2) * 1000))):
                # Nothing is sounding: let the card run dry, so its buffer starts again from empty.
                last_resync = now
                time.sleep(RESYNC_PAUSE)
                mixer.skip_to(frame_at(clock.now() + args.delay))
            if now - last_sync > 30:
                last_sync = now
                try:
                    clock.sync()
                except (OSError, ValueError, KeyError):
                    pass
            if now - last_stats > 10:
                last_stats = now
                if mixer.pieces:
                    print('%d pieces, %d late, time to spare min %.0f ms avg %.0f ms' % (
                        mixer.pieces, mixer.late, mixer.spare_min, mixer.spare_sum / mixer.pieces), flush=True)
                    mixer.pieces = mixer.late = 0
                    mixer.spare_min = None
                    mixer.spare_sum = 0.0
            if args.seconds and now - started > args.seconds:
                break
    except KeyboardInterrupt:
        pass
    except BrokenPipeError:
        sys.exit('the sound player stopped taking sound')
    finally:
        stop.set()
        if child:
            child.terminate()


if __name__ == '__main__':
    main()
