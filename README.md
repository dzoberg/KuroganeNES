# KuroganeNES - 黒鋼

A cycle-accurate NES / Famicom Disk System emulator that runs entirely in the browser as a single self-contained HTML file. No installation, no plugins, no build step. Drop a ROM and play.

---

## Quick Start

Open `nes.html` in any modern browser. Drag and drop a ROM onto the screen, or click anywhere to open the file picker.

For Famicom Disk System games, load a `.fds` file the same way. A clean-room BIOS is built in - no external `disksys.rom` required, though the original Nintendo BIOS can be loaded in Settings if preferred.

The emulator runs fully offline when opened as a local file. Save states, NVRAM, and tape data all persist in IndexedDB. Multiplayer, microphone access, and the barcode camera scanner require a secure HTTPS context and are unavailable on `file://`.

---

## Emulation Core

The CPU, PPU, APU, and DMA engine are all custom implementations built from scratch against NESdev hardware documentation and verified against silicon behavior.

### CPU - Ricoh 2A03
Cycle-accurate NMOS 6502 execution including all documented and undocumented opcodes, correct open bus behavior, hardware-accurate page-crossing penalties, and sub-instruction interrupt polling. Every instruction runs the correct number of cycles - dummy reads, RMW write cycles, and all the edge cases games depend on.

### PPU - Ricoh 2C02
Full scanline/dot state machine: sprite evaluation, sprite-zero hit, sprite overflow, background/sprite priority, color emphasis, and NTSC timing. Per-chip flags cover RP2C02, RP2C04 variants, RC2C03, and the RC2C05 series for accurate Vs. System and PlayChoice-10 output.

### APU - Ricoh 2A03 Sound
Pulse 1/2, Triangle, Noise, and DMC with NESdev-accurate envelope, sweep, length counter, and frame counter sequencing. Output via Web Audio API with a refresh-rate-decoupled accumulator to prevent drift at non-60Hz display rates.

### DMA Engine
OAM DMA ($4014) and DMC DMA with full cycle-accurate put/halt/get sequencing, even/odd CPU cycle alignment, bus conflict emulation with APU registers, and correct PPU open bus interaction.

KuroganeNES scores **137/137** on [AccuracyCoin](https://github.com/100thCoin/AccuracyCoin), a comprehensive NES hardware test suite covering CPU timing, DMA sequencing, PPU register behavior, APU frame counter accuracy, interrupt edge cases, and more.

---

## Features

### Format Support
- **iNES** (.nes) - iNES 1.0 and NES 2.0 with full header parsing and CRC32 database correction
- **UNIF** (.unf / .unif) - extended cartridge format
- **TNES** (.tnes) - Nintendo 3DS Virtual Console format
- **Famicom Disk System** (.fds) - 2C33 ASIC wavetable + modulation audio, BIOS-free
- **NSF / NSFe** (.nsf / .nsfe) - NES Sound Format player with per-channel oscilloscope and piano-roll visualizer

### Mapper Support - 328 mappers

NROM (0), MMC1/SxROM (1/155), UxROM (2), CNROM (3), MMC3/TxROM (4), MMC5/ExROM (5), FFE F4xxx (6), AxROM (7), FFE F3xxx (8), MMC2/PxROM (9), MMC4/FxROM (10), Color Dreams (11), REX DBZ5 (12), CPROM (13), SL-1632 (14), K-1029/K-1030P (15), FFE F8xxx (17), Namco 163/175/340 (19/210), FDS (20), VRC2/VRC4 (21/22/23/25), VRC6 + expansion audio (24/26), World Hero VRC4 pirate (27), Action 53 homebrew multicart (28), RET-CUFROM (29), UNROM 512 (30), INL-ROM/NSF-on-cart (31), BNROM/NINA-001 (34), SC-127 (35), TXC 01-22000-400 (36), PCI556 (38), NTDEC 2722/SMB2J (40), Caltron 6-in-1 (41), AC08 FDS conversion (42), TONY-I/YS-612 (43), Rumblestation (46), N-32 SMB2J (50), BMC 11-in-1 (51), BMC Super Mario multicart (52), Supervision 16-in-1 (53), BTL-MARIO1-MALEE (55), Kaiser KS202/SMB3 pirate (56), GK 47-in-1 (57), 68-in-1/97-in-1 (58), BMC-T3H53 (59), Reset-based 4-in-1 (60), NTDEC GS-2017 (61), Super 700-in-1 (62), BMC 250-in-1 (63), Tengen RAMBO-1 (64/158), GxROM (66), Bandai 74×161 (70/152), Codemasters/Camerica (71/232), VRC3 (73), VRC1 (75/151), Napoleon Senki (77), Irem 74HC161 (78), NINA-03/06 (79/146), NTDEC 7152 (81), Cony/Yoko (83), VRC7/OPLL FM (85), Jaleco JF series (87/89/93/94/97/101/140), J.Y. Company ASIC (90/91/209/211), Sunsoft FME-7/5B (69), Namco 108 family (88/95/154/206), TxSROM/TKSROM (118), TQROM (119), Kaiser KS7032 (142), Sachen series (133/143/144/145/148/149), TXC ASIC series (132/172/173), Waixing variants (162/163/164/165/176/177/178/198/199/245/249/253), BMC multicarts (51-63/174/200-237), AVE NINA-08 (487), Sachen 9602 (513), Family Noraebang (515), Dance 2000 (518), EH8813A (519), DreamTech01 (521), LH10 (522), T-230 (529), AX5705 (530), UNL-NJ003 (534), VRC5/QTa (547), BMC 12-in-1 GN (551), Taito X1-017 (552), NCC 1991 (555), UNL-YC-03-09 (558), UNL-BATMAP (561), UNL-EHROM (562), Rainbow (682)

### Expansion Audio
- **VRC6** - 2 pulse + 1 sawtooth (Konami)
- **VRC7 / OPLL** - 6-channel FM synthesis; full YM2413 patch ROM from die-shot verified Nuke.YKT data
- **MMC5** - 2 pulse + PCM channel
- **Namco 163 (N163)** - up to 8 wavetable channels
- **Sunsoft 5B** - YM2149F / AY-3-8910 PSG
- **FDS audio** - 2C33 ASIC wavetable + modulation channel
- **EPSM (YMF288)** - OPN3L FM + ADPCM rhythm, 8KB rhythm ROM embedded

### Peripheral Support
- Standard NES controller (keyboard, gamepad, touch)
- Four Score / Four Player adapter (2P and 4P)
- Zapper light gun (mouse + touch with crosshair overlay)
- Oeka Kids Tablet (mouse/touch stylus input)
- Power Pad / Family Fun Fitness mat (keyboard + mobile overlay)
- Family BASIC Keyboard (full matrix, mobile touch overlay)
- Subor Keyboard SB-97 / SB-486D (full matrix, mobile touch overlay)
- Famicom microphone (2P controller mic input)
- Vs. System (coin input, DIP switches, hardware-accurate RGB PPU palettes for all 2C04 variants)
- PlayChoice-10
- Datach Barcode Reader (EAN-13/UPC-A via camera or manual digit entry)
- EPOCH Barcode Battler II expansion port scanner

### Gameplay Features
- **Save states** - 4 slots per game, persisted in IndexedDB, keyed by ROM hash
- **Rewind** - hold F5 to rewind in real time; up to 4 hours of history, XOR-delta compressed
- **Fast forward** - hold F6 to run at 4× speed; audio mutes automatically
- **Data Recorder** - Famicom Data Recorder emulation; record and play tapes, save and load unlimited named tapes per game (stored in IndexedDB); export/import as WAV
- **Game Genie** - enter and toggle cheat codes mid-session
- **ROM patching** - apply IPS, BPS, xdelta3/VCDIFF, UPS, PPF, RUP, and APS patches in the browser
- **NSF player** - NSF/NSFe playback with per-channel oscilloscope, piano roll, track navigation, and channel mute
- **Integer scaling** - pixel-perfect scaling at any window size
- **CRT filter** - optional scanline or dot matrix overlay
- **Fullscreen** - browser fullscreen with retained aspect ratio

### Multiplayer
Lockstep netplay over WebSocket via the companion `nes-server.js` relay. Supports 2-player and 4-player (Four Score). The host transfers the ROM to the guest automatically - no file sharing required. Includes live ping display, dead-client detection, and a hardware pause overlay on disconnect.

### Hosting a Game

1. Start `nes-server.js` and navigate to your server address in a browser. The multiplayer controls are hidden when the file is opened locally - they only appear when served over HTTP/HTTPS.
2. Load the ROM you want to play.
3. Click the **Link** button in the toolbar, then click **Host**. A 4-character room code appears - share it with your opponent.
4. When the guest connects you'll see a notification. The ROM transfers automatically. The host plays as 1P, the guest as 2P.

For 4-player sessions, enable Four Score in Settings before hosting. Guests choose their slot (2P / 3P / 4P) on join.

### Joining a Game

1. Navigate to the server address in a browser.
2. Click **Link**, then **Join**.
3. Enter the 4-character room code and press Enter or click **Go**. The ROM transfers and the game starts automatically.

### During a Session

The toolbar locks while connected - ROM loading, reset, pause, settings, debug, rewind, and fast forward are all disabled to prevent desync. Cheats are automatically disabled too.

A live ping display shows round-trip latency. If a guest disconnects, the game freezes and an overlay shows the room code so they can rejoin. Click **Continue** to resume without them, or wait for reconnect. Click **✕** to end the session and unlock the toolbar.

### Developer Tools
- **CPU / PPU registers** - live register state display
- **CPU tracer** - instruction-level execution log
- **Breakpoints** - CPU address breakpoints, scanline breakpoints, and break-on-NMI/IRQ with snap-to-code
- **Watch list** - monitor memory addresses with size selection and change highlighting
- **Heat map** - per-address read/write frequency visualization
- **PPU register log** - capture and review PPU register writes
- **Nametable viewer** - live VRAM with scroll position overlay
- **Pattern table viewer** - CHR banks with palette selection
- **Tile inspector** - click any tile on the nametable viewer to inspect its attributes
- **OAM inspector** - per-sprite tile, position, and attribute data
- **Palette viewer** - background and sprite palette colors
- **Memory viewer** - CPU and PPU bus hex editor
- **Mapper state viewer** - live PRG/CHR bank mapping
- **APU registers** - live APU register state
- **APU oscilloscope** - per-channel waveform display
- **EPSM debug** - YMF288 register viewer and log (appears for EPSM games)
- **OPLL debug** - YM2413 register viewer and log (appears for VRC7 games)
- **NMI / IRQ timeline** - interrupt timing visualization
- **TAS Studio** - frame-advance input recording and playback (see below)

### Platform
- Single `.html` file - no server required for solo play
- Fully mobile-responsive with on-screen touch D-pad, buttons, and player toggles
- Refresh-rate decoupled main loop - runs correctly at 60, 120, 144Hz and above
- No npm, no build tools, no install step

---

## Hotkeys

All hotkeys are fully rebindable in Settings, including gamepad equivalents.

| Key | Action |
|-----|--------|
| F1 | Open ROM |
| F2 | Pause / Resume |
| F3 | Warm Reset |
| F4 | Hard Reset |
| F5 | Rewind (hold) |
| F6 | Fast Forward (hold) |
| F7 | Save State |
| F8 | Load State |
| F9 | FDS Eject Disk |
| F10 | FDS Flip Disk Side |
| F11 | Fullscreen |
| F12 | Mute |
| Shift+F1 | Toggle Keyboard Mode |

**Keyboard Mode** disables all controller input and hotkeys so keyboard input passes directly to games that use the keyboard (Family BASIC, Subor, etc.).

**Default Player 1 controls:** Arrow keys, Z (B), X (A), Shift (Select), Enter (Start).

---

## TAS Studio

The TAS Studio records and plays back frame-precise input sequences. It supports 1P and 2P inputs, FDS disk operations, Game Genie cheats, and NVRAM - everything needed to reproduce a run deterministically.

### Opening the Panel

Click **TAS** in the toolbar. The panel slides in from the right without pausing the game.

### Recording

1. Load the ROM you want to record.
2. Click **New** in the TAS panel. This resets the game to a known state and begins recording.
3. **Pause** the game (F2). With the game paused, toggle inputs directly on the panel - each button click XORs that input into the current frame. The mini screen preview reflects your changes.
4. Press **Frame Advance** (the › button, or hold for auto-repeat) to step forward one frame, commit the inputs, and move to the next.
5. To record in real time, **unpause** the game. You can close the panel entirely and play normally - recording continues in the background. Reopen the panel at any time to resume frame-stepping.

### Editing

Click any row in the input roll, or use **Go to Start**, to seek to an earlier frame. Seeking uses greenzone snapshots captured every 60 frames for near-instant jumps. Overwrite from that point by entering new inputs and stepping forward.

### Playback

Click **Play** to replay from the current frame at normal speed. The **Stop** button returns to recording mode. You can pause mid-playback, adjust inputs, and resume.

### Panel Workflow

- **Close the panel** to play freely - the movie stays active and recording continues.
- **Reopen** to return to frame-stepping at any time.
- Rewind, fast forward, warm reset, and hard reset are all blocked while a movie is active.

### Saving and Loading

Click **Save** to download a `.tas` file containing the ROM hash, cheat codes, FDS BIOS fingerprint, NVRAM snapshot, and one hex input pair per frame. Click **Load** to open a `.tas` file - the ROM hash and FDS BIOS are verified before loading, with a clear error on mismatch.

---

## Settings

Open Settings with the gear icon in the toolbar.

### Display
CRT filter (off, scanlines, dot matrix), overscan crop (none, TV/CRT, action safe), aspect ratio (8:7 pixel-perfect or 4:3 CRT), and integer scaling toggle.

### Audio
Master volume and per-channel faders for Pulse 1, Pulse 2, Triangle, Noise, and DMC. An Expansion fader appears when a game uses expansion audio (VRC6, VRC7, MMC5, N163, 5B, FDS, EPSM).

### Cartridge Swap
Hot Swap ROM lets you load a new ROM without a power cycle, preserving CPU RAM. Useful for multicarts and game switchers.

### Cheats
Enter Game Genie codes (6-letter or 8-letter) and toggle them on or off. Codes take effect on the next reset, matching real hardware behavior.

### Save Data
Appears only when a battery-backed NVRAM game is loaded. Export a `.sav` to back up save data, or import one to restore it.

### Save States
Four slots per game, persisted in IndexedDB and keyed by ROM hash. Select a slot, then Save, Load, or Delete. F7/F8 operate on the selected slot.

### DIP Switches
Appears only for Vs. System arcade games. Configures coin mode, difficulty, lives, and other hardware DIP settings for that specific title. Changes take effect after reset.

### Hotkeys
Rebind all keyboard and gamepad hotkeys. Click any binding to enter listen mode, then press a key or gamepad button. Press Backspace to clear a binding.

### Controls - Player 1 / Player 2

Keyboard and gamepad bindings for each button. **When you first connect a gamepad, press any button on it** - browsers require user interaction before exposing a controller through the Gamepad API. Once detected, an **Input** dropdown appears at the top of each player section listing all connected controllers by name. Select one to assign it to that player; the key map switches to show gamepad bindings.

The emulator remembers your preferred controller per player. If you disconnect and reconnect a gamepad - even across sessions - it is automatically restored to the correct slot without any manual reassignment.

All buttons are individually rebindable: A, B, Select, Start, and the D-pad. Vs. System games add COIN and START bindings for both keyboard and gamepad. Turbo A/B are configured separately in the Turbo section. 3P and 4P sections appear when Four Score is enabled.

### Peripheral

- **Force Famicom Mic** - enable microphone for all games. When off, microphone activates automatically for games known to use it.
- **Force Family Keyboard** - enable Family BASIC Keyboard for all games. When off, keyboard activates automatically for compatible games.
- **Force Subor Keyboard** - enable Subor Keyboard (SB-97) for all games. When off, keyboard activates automatically for Subor educational software. Mutually exclusive with Family Keyboard.
- **Force Data Recorder** - enable Famicom Data Recorder for all games. When off, tape controls appear automatically for compatible games. Record and play back tapes, save and load unlimited named tapes per game (stored in IndexedDB), and export or import tapes as WAV files.
- **Force Barcode Battler II** - enable Barcode Battler II expansion port scanner for all games. When off, scanner activates automatically for compatible games (Barcode World). Datach scanner activates automatically on mapper 157.
- **Four Score** - enable NES Four Score adapter for 4-player games. Connects to both controller ports. Auto-detected from game database.
- **Port 2 Device** - select the peripheral connected to controller port 2. Options: Auto Detect, Zapper, Oeka Kids Tablet, Power Pad (Side A), Power Pad (Side B). Auto uses the game database to detect peripherals. Zapper: click/tap screen. Oeka Kids Tablet: draw with mouse/touch. Power Pad: keyboard or mobile overlay.

### Turbo
Toggle turbo on or off and rebind turbo A and turbo B per player. Turbo fires the assigned button at 20 presses per second while held.

### Input Monitor
Live readout of all active inputs for 1P-4P. Useful for verifying that a gamepad or keyboard binding is working without launching a game.

### System
- **Microphone Access** - lets compatible games use the device microphone (requires HTTPS). If disabled, tap and hold the on-screen mic indicator during gameplay instead.
- **Camera Access** - used by the barcode scanner (requires HTTPS). Disabled falls back to manual digit entry.
- **Show Mobile Controls (Desktop)** - forces the touch D-pad and buttons to appear on desktop.
- **Haptic Feedback** - vibration on mobile button presses.
- **Block Opposite D-Pad** - prevents simultaneous left+right or up+down, matching real D-pad hardware behavior.
- **VRC IRQ Stabilize** - reduces minor status bar jitter in Konami VRC games. Not hardware-accurate; off by default.
- **Palette** - PPU color palette. Auto-detects from the ROM database. Manual options: RP2C02 (NTSC), RP2C07 (PAL), and the four RP2C04 arcade variants for Vs. System games.
- **Region** - timing region. Auto-detects from the ROM database. Manual options: NTSC, PAL, Dendy.

### Actions
- **FDS BIOS** - load a `disksys.rom`. An embedded clean-room BIOS is included; this action lets you replace it with the original Nintendo BIOS. The ✕ restores the embedded version.
- **EPSM ROM** - load a custom YMF288 rhythm ROM. An embedded reconstructed ROM is included.
- **Load ROM** - open the file picker (same as F1).
- **Apply Patch** - apply a patch to the currently loaded ROM. The ✕ removes it and restores the original.
- **Hard Reset** - power-cycle the emulated hardware.
- **Reset Settings to Default** - restores all settings. Save states and game data are preserved.
- **Clear All Saved Data** - wipes all save states, NVRAM, and settings from browser storage.

---

## Multiplayer Server

`nes-server.js` is the companion WebSocket relay for netplay. Zero npm dependencies - the WebSocket protocol (RFC 6455) is implemented from scratch using only Node.js stdlib. A single port serves both HTTPS and WSS, and the server hosts `nes.html` directly so guests connect via the same URL.

### Requirements
- Node.js (any recent LTS version)
- A TLS certificate - HTTPS is required for gamepad and audio APIs in browsers
- Port 8888 accessible in your firewall and router

### Certificate Options

**Option A: Let's Encrypt + DuckDNS (recommended for remote play)**

DuckDNS provides a free subdomain. Register at [duckdns.org](https://www.duckdns.org), create a subdomain, then:

```bash
pip install certbot certbot-dns-duckdns
sudo certbot certonly --authenticator dns-duckdns \
  --dns-duckdns-token YOUR_TOKEN \
  --dns-duckdns-propagation-seconds 120 \
  -d "yourname.duckdns.org"
```

Copy the generated certs to the same directory as `nes-server.js`:

```bash
sudo cp /etc/letsencrypt/live/yourname.duckdns.org/fullchain.pem cert.pem
sudo cp /etc/letsencrypt/live/yourname.duckdns.org/privkey.pem key.pem
node nes-server.js
```

Renew with `sudo certbot renew` and re-copy the files. Guests connect at `https://yourname.duckdns.org:8888`.

**Option B: Let's Encrypt with any DNS provider**

```bash
sudo certbot certonly --authenticator dns-<provider> \
  --dns-<provider>-credentials ~/credentials.ini \
  -d "yourdomain.com"
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem key.pem
node nes-server.js
```

See the [certbot DNS plugins list](https://certbot.eff.org/docs/using.html#dns-plugins) for supported providers.

**Option C: Self-signed certificate (localhost only)**

Run this from the same directory as `nes-server.js`:

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \
  -days 365 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
node nes-server.js
```

That's it. The command creates `cert.pem` and `key.pem` right where the server expects them. Browsers will show a security warning on first visit - click through to proceed. Not suitable for remote play.

### Starting the Server

```bash
node nes-server.js
```

On startup the server prints its addresses:

```
 ╔══════════════════════════════════════╗
 ║        KuroganeNES  ·  v1.0          ║
 ╚══════════════════════════════════════╝

   Local:   https://localhost:8888
   Network: https://192.168.1.x:8888

   Multiplayer: 2P / 4P · WebSocket relay
```

The default port is **8888**. To use a different port, either set the `PORT` environment variable or edit the `PORT` constant in `nes-server.js`:

```bash
PORT=9000 node nes-server.js
```

### Firewall / Router

For remote play, open port 8888 in your server's firewall and forward it in your router:

```bash
sudo ufw allow 8888/tcp   # Ubuntu/Debian
```

### Running as a Background Service (optional)

```bash
# With pm2
npm install -g pm2
pm2 start nes-server.js --name kurogane
pm2 save

# Or with nohup
nohup node nes-server.js &
```

---

## File Structure

```
nes.html          - The complete emulator (open in any modern browser)
nes-server.js     - WebSocket relay server for multiplayer (Node.js, no npm)
cert.pem          - TLS certificate (you provide - see server setup above)
key.pem           - TLS private key  (you provide - see server setup above)
```

---

## Technical Notes

The entire emulator - all mappers, UI, peripheral logic, and debug tooling - ships in a single `.html` file. pako (zlib) and RomPatcher.js are bundled inline. Press Start 2P and VCR OSD Mono are embedded as subsetted woff2 data URIs. There are no external requests.

Mapper implementations and hardware quirks are cross-referenced against the NESdev wiki. The built-in ROM database uses CRC32 fingerprinting to auto-correct iNES 1.0 headers and identify the correct mapper, mirroring mode, timing region, and peripheral type for thousands of known ROMs.
