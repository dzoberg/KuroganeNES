# KuroganeNES (黒鋼)

A cycle-accurate NES and Famicom Disk System emulator that runs entirely in the browser as a single self-contained HTML file. There's no installer, no plugins, and no build step. Open the file, load a ROM, and play.

## Features

- Cycle-accurate NES / Famicom and Famicom Disk System emulation, verified against the blargg test ROMs and a perfect 140/140 on the AccuracyCoin suite.
- Broad mapper support with CRC32 ROM fingerprinting that auto-corrects iNES headers and picks the right mapper, mirroring, timing region, and peripherals for thousands of known games.
- NTSC and PAL timing, plus an optional composite-video mode that's a real signal-domain simulation (encode, demodulate, comb-filter) rather than a post-process overlay.
- Expansion audio for VRC6, VRC7, FDS, MMC5, Namco 163, Sunsoft 5B, and EPSM.
- Save states, rewind, and fast-forward.
- Local and online multiplayer, 2P and 4P (Four Score), over a lightweight WebSocket relay.
- Peripherals beyond controllers: the Zapper light gun (with a beam-timing photodiode model rather than a simple pixel check), Power Pad, Family Basic and Subor keyboards, Oeka Kids tablet, and the Famicom microphone, all auto-selected per game from the ROM database.
- Vs. System arcade support with per-game DIP switches.
- Game Genie cheats and built-in ROM patching (IPS, BPS, and xdelta).
- An NSF music player with a piano-roll visualizer, and a TAS studio for frame-by-frame input recording and playback.
- A full suite of debugging tools, including a CPU/PPU debugger, memory and nametable viewers, pattern and palette inspectors, an execution heatmap, and an APU oscilloscope with per-channel mute.
- Fully self-contained. All the code, fonts, and libraries are inlined, so the page makes no external requests.

## Running the Emulator

Open `nes.html` in any modern browser. That's all there is to it, no server needed for single-player. Load a ROM with the file picker or just drag it onto the window.

## Multiplayer Server (optional)

Online play uses `nes-server.js`, a zero-dependency Node.js WebSocket relay that also serves `nes.html` over HTTPS. You only need it for online multiplayer. Local play and single-player run straight from the file.

### Requirements

- Node.js (any recent LTS version)
- A TLS certificate, since browsers require HTTPS for the gamepad and audio APIs
- Port 8888 reachable through your firewall and router for remote play

### Certificate setup

**Remote play (Let's Encrypt).** Works with any DNS provider certbot supports. DuckDNS is a free one:

```bash
sudo certbot certonly --authenticator dns-duckdns \
  --dns-duckdns-token YOUR_TOKEN \
  -d "yourname.duckdns.org"

sudo cp /etc/letsencrypt/live/yourname.duckdns.org/fullchain.pem cert.pem
sudo cp /etc/letsencrypt/live/yourname.duckdns.org/privkey.pem  key.pem
```

The server can also read certs straight from `/etc/letsencrypt/live/<domain>/` if you set `LE_DOMAIN=yourname.duckdns.org`.

**Local testing (self-signed).** Run this from the same directory as `nes-server.js`:

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \
  -days 365 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
```

Browsers will warn you about a self-signed cert, just click through. This one's only good for localhost, not remote play.

### Start the server

```bash
node nes-server.js
```

It prints its local and network addresses when it starts. The default port is 8888. To change it, run `PORT=9000 node nes-server.js`. For remote play, open the port in your firewall (`sudo ufw allow 8888/tcp`) and forward it in your router. Guests connect at `https://yourname.duckdns.org:8888`.

To keep it running in the background, use pm2 (`pm2 start nes-server.js --name kurogane`) or `nohup node nes-server.js &`.

## Files

```
nes.html        The emulator. Open it in any browser.
nes-server.js   WebSocket relay for online multiplayer (Node.js, no npm).
cert.pem        TLS certificate (you provide, see setup above).
key.pem         TLS private key (you provide, see setup above).
```

## License

KuroganeNES is released under the MIT License (see `LICENSE`). The bundled components (pako, RomPatcher.js, and the embedded fonts) keep their own licenses.
