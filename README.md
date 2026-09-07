# KuroganeNES (黒鋼)

A cycle-accurate NES and Famicom Disk System emulator that runs entirely in the browser as a single self-contained HTML file. There's no installer, no plugins, and no build step. Open the file, load a ROM, and play.

## Features

- Cycle-accurate NES / Famicom and Famicom Disk System emulation, modeled on the NES-001 (RP2A03G + RP2C02G), verified against the blargg test ROMs, a byte-exact nestest log, and a perfect 144/144 on the AccuracyCoin suite on every one of the console's four CPU/PPU clock alignments.
- Broad mapper support with CRC32 ROM fingerprinting that auto-corrects iNES headers and picks the right mapper, mirroring, timing region, and peripherals for thousands of known games.
- NTSC and PAL timing, plus a composite-video mode that is a true analog model: the PPU's 9-bit pixel codes are turned into the actual NTSC (2C02) or PAL (2C07) waveform from measured voltage levels and decoded like a television, with comb, notch and PAL delay-line presets, burst-locked color, and a WebGL2 decoder at signal resolution. Clean mode is the ideal decode of the same signal.
- Expansion audio for VRC6, VRC7, FDS, MMC5, Namco 163, Sunsoft 5B, and EPSM.
- Save states, rewind, and fast-forward, with phase-locked frame pacing and dynamic audio rate control so playback stays smooth on any display, including phones that miss or bunch frames.
- Local and online multiplayer, 2P and 4P (Four Score), over a lightweight WebSocket relay.
- Peripherals beyond controllers: the Zapper light gun (with a beam-timing photodiode model rather than a simple pixel check), Power Pad, Family Basic and Subor keyboards, Oeka Kids tablet, and the Famicom microphone, all auto-selected per game from the ROM database.
- Vs. System arcade support with per-game DIP switches.
- Game Genie cheats with nameable codes, and built-in ROM patching (IPS, BPS, and xdelta).
- An NSF / NSFe / NSF2 music player with region-correct playback, multi-chip expansion audio, and a piano-roll visualizer with real pitch for every chip, plus a TAS studio with instant frame stepping, deterministic movies, and Vs. / FDS support.
- A full suite of debugging tools, including a CPU/PPU debugger, memory and nametable viewers, pattern and palette inspectors, an execution heatmap, and an APU oscilloscope with per-channel mute.
- An interface made of the console's materials: a black bezel for the picture, the NES-001's grey shell for the deck and settings, and its red for the controls and wordmark. The same layout on desktop and phone, with every tool one tap away.
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

## Changelog

### v1.1.0

**Accuracy**

- **CPU/PPU clock alignment.** Real hardware powers up with its CPU divide-by-12 and PPU divide-by-4 dividers in one of four relative phases, and the NES-001 draws a new one on Reset. The emulator now does both, weighted by blargg's measured power-on and reset likelihoods, and the phase travels with save states, TAS movies and netplay. A sub-cycle access model makes every phase valid: bus reads and writes land at clock 4 of the 12-clock cycle, the NMI input is sampled at clock 8, and the `$2002` sprite flags and the `$2004` OAM bus are sampled at the fall of M2. Phase 0 is byte-for-byte the previous model. All 144 AccuracyCoin tests pass on all four phases, and one phase reproduces two documented alignment variants of the real console (the alternate `$2002` flag-clear key and the `$00` flag-set byte). A fixed phase can be pinned in Settings for repeatable test runs.
- **Exact 2A03 DAC mixer.** The pulse and triangle/noise/DMC mixers use the measured non-linear curves (`95.88 / (8128 / n + 100)` and the three-input `159.79 / ...` surface as a 16x16x128 table) in place of the earlier linear approximations.
- **MMC3 IRQs in 8x16 sprite games.** Empty sprite slots now fetch through the same address path as live sprites, so the dummy tile `$FF` selects the `$1000` pattern table in 8x16 mode and clocks A12 every scanline. Games with `$2000.3` clear previously got no scanline IRQs at all; they now get the hardware's 11 to 12 per frame.
- **`$2007` during rendering** is gated on visible and pre-render lines only, which fixes reads on the Dendy's 51 post-render lines.
- **PPUSTATUS overflow bit** is part of the deterministic power-on seed record. TAS movies carry a sixth seed field, and older movies load with the default.

**Timing and audio**

- **Phase-locked frame pacing** replaces the 1.0.2 vsync lock. The lock ran exactly one frame per display callback once the callback rate looked like 60 Hz, so every missed callback on a phone drained 16 ms of audio that a 0.5% rate controller could never refill, and a display drifting around 59 Hz alternated between skipping music and bursting frames. The new pacer tracks the wall-clock phase error with a one-frame deadband: jitter does nothing, a missed callback is repaid with one extra frame immediately, bunched callbacks skip one, and stalls are forgiven. 60 Hz-class panels stay display-paced with the 60 / 60.0988 drift absorbed by the audio resampler; 90, 120 and 144 Hz panels and throttled phones pace to real time. Zero underruns on every replayed callback pattern that broke the previous build. The same pacer drives TAS playback and the NSF player.
- **Adaptive audio latency** on phones (96 ms, shrinking to 64 ms and growing again after an underrun), Safari's interrupted-state resume, and resume on tab return.
- The on-screen controls no longer read layout in `touchmove`. Geometry is cached per gesture and visual state is coalesced per frame.

**Interface**

- **Redesigned throughout**, with nothing moved out of reach. The toolbar keeps all eight actions, labelled on desktop. The status bar becomes a console strip of chips, with disk, tape, barcode and netplay controls appearing as rows when a game needs them. The on-screen controls become a deck: the console's grey shell with its red stripe, the I/II selector in the Famicom's serif numerals, rewind, fast-forward and Turbo, over a controller face with a bevelled cross, grey pills and red domed A and B. One typeface (Archivo, embedded), one accent, and no pixel fonts outside the picture and the NSF readout.
- **Press feedback rule.** Keys dip on press; colour is reserved for state (Turbo, TAS toggles, the LED). In TAS Studio every input is a lamp, dark when the frame's input is off and red when it is on, including A, B, the D-pad, Select, Start, disk eject and side, and the Vs. start and coin keys.
- **Settings** on one page, no sub-menus: a grouped index that jumps and follows your scrolling, and a search box that filters rows without disturbing the rows the emulator hides itself. Composite-only controls stay hidden under Clean.
- **A breathing focus ring** for keyboard and gamepad navigation, toasts as shell pills, and the debugger, TAS Studio and NSF panels restyled in place.
- The previous look was retired, and the Interface setting is gone.

**Mobile**

- The picture is centred in the space above the deck and never covered by it. It is placed before its first frame, so loading a game no longer slides it, and it re-centres smoothly when a gamepad hides the controls.
- Landscape keeps compact chrome (icons only, no title) and floats the controls over the picture's sides, giving the picture the full height. Integer scaling below 2x snaps to quarter steps, so a landscape phone runs at 1.5x instead of dropping to 0.5x.
- The Power Pad, Family BASIC and Subor keyboard overlays scale to the height the phone actually has, and the strip's chips grow to 28 px keys. The strip's real height drives the layout, so nothing is ever clipped behind it.
- The Famicom microphone indicator is a deck key that glows while the mic is live.

**NSF player**

- **Keyboard-style piano roll.** Five equal lanes with piano-key banding, a sliding pitch marker on the gutter that names a note once it has been held, note names inside bars that are wide enough, bars weighted by volume and fading with age, a 2.5 / 5 / 10 s window, and a Roll / Scope / Both view. Per-lane readouts show the slow facts (duty, arpeggio chord, period and mode, DMC level) with a volume meter, hold their text for at least 300 ms and never blank on a rest, so fast music no longer strobes the text.

**Data Recorder**

- The tape deck's management actions are words (Save, Load, Export, Import, Erase) rather than icons, and the readout speaks like a deck: "Blank tape, press the record key", "Recording 0:12", "Playing 0:05 / 0:42", "mytape.wav 0:42".

**Tooling**

- Browser-level regression harness (headless Chromium): the full AccuracyCoin suite per clock phase, alignment-variant measurement, a pacing replay of recorded phone callback patterns with an emulation-invariant hash, an MMC3 A12 matrix, touch path, settings rail, and phone layout checks (overlap, load stability, overlay fit, strip wrapping). Everything above was verified with it before shipping.

### v1.0.2

**Accuracy**

- **AccuracyCoin 144/144.** Three PPU fixes: sprite evaluation now runs at the hardware dot with a real 5-bit secondary-OAM address counter and overflow latch (fixes the `$2004` stress test, Frozen OAM2 Increment and Misaligned OAM2 Address); the MMC3 A12 idle drive on the pre-render line is correct at dot 0 (fixes `mmc3_test` 4-scanline_timing); and a warm reset no longer clobbers A/X/Y or miscomputes the stack pointer (fixes `cpu_reset/registers`). Every blargg suite passes: CPU instructions, timing, interrupts, dummy reads/writes, PPU VBL/NMI, sprite hit and overflow, OAM, APU (2005, 2013 and PAL sets), DMC DMA, MMC3 IRQ.
- **PPU reset signal.** The 2C02's internal reset signal is now a real state bit: on the NES-001 the Reset button holds `$2000/$2001/$2005/$2006` cleared until the end of the first VBlank (29658 cycles NTSC, 33132 PAL, measured exactly), released by the same event that clears the VBL flag. Power-on models a cold boot by default, as AccuracyCoin's reference console does; a setting selects the quick-power-cycle behavior. The PPU now starts at the top of the picture on power-on and reset, so the first VBL lands at 27384 cycles as on hardware.
- **Vs. System coin state** is now part of save states, rewind and the TAS greenzone.
- **Deterministic power-on.** OAM contents, the VBL flag and the DRAM-decay generator are drawn from one seed record that TAS movies carry, so a movie replays identically on another machine.

**Video**

- **Composite rewritten as a four-stage analog pipeline.** Every dot of every line, including borders, porches, sync and colorburst, becomes a 9-bit code from the PPU; the waveform is synthesized from lidnariq's measured levels with phase-selective emphasis (emphasized greys and whites now carry their tint), the chroma phase is derived from the master clock (correct through the skipped dot and forced-blank frames), and differential phase distortion is applied per chip revision. The television stage locks to the burst, references chroma gain to the burst amplitude like a real ACC, and offers Comb filter, Notch filter, PAL delay line and PAL simple presets, black level (0 / 7.5 IRE), tint, saturation and sharpness. No fitted constants remain.
- **Clean mode is now the ideal decode of the same generator**, computed for all 512 color-and-emphasis combinations per PPU model (2C02G, 2C07, UA6538), replacing the old channel-scaling emphasis approximation. Flat colors match between Clean and Composite to the bit.
- **PAL oscillator pairing** follows the wiki's 2C07 description (hues 3/2, 4/1, 5/C, 6/B, 7/A, 8/9), which fixes `$xB` and `$xC` on PAL and removes the even/odd luma mismatch on emphasized colors.
- **WebGL2 composite decoder** at signal resolution (768 NTSC / 1280 PAL), validated against the CPU decoder; automatic fallback to the CPU path. Signal or native resolution is selectable.
- Composite-only settings are hidden under Clean.

**Performance**

- About 30% less CPU per frame with bit-identical audio: the APU mixer runs only when a channel state can change, a per-cycle closure allocation is gone, and vertical-blank lines are advanced in one block when nothing can happen on them.
- Hot emulator state moved off script-scope variables, which removes a V8 deoptimization loop that made some engine builds 20× slower.
- Audio dynamic rate control (the worklet reports its fill level; the resampling ratio is nudged by at most ±0.5%) and vsync-locked frame pacing end the periodic dropouts and hitches.
- One shared frame-run loop for play, fast-forward, rewind, TAS and multiplayer; dead code removed.

**Input**

- Gamepad and keyboard bindings are compiled once and cached; `getGamepads()` is polled only while a pad is connected; hotkeys use a precompiled list. About 3× less per-frame input work.
- A pad with the standard mapping is usable immediately: NES A = east, B = south, Select/Start = 8/9, d-pad = hat, applied only to players with no bindings of their own.

**TAS Studio**

- Instant Frame Back and short seeks from a per-frame state ring; denser greenzone; editing an earlier frame invalidates the snapshots that depended on it (previously a stale snapshot could be restored).
- Frame 0 restores through the same binary snapshot as every other seek target.
- The piano roll updates incrementally on step, click, pause and seek instead of rebuilding 200 rows; playback appends rows a few at a time.
- Movie files record region, MMC3 revision, the PPU reset-signal setting and the power-on seeds; loading with a mismatched setting says which one.

**Debugger**

- The nametable, pattern-table, OAM, palette and memory viewers redraw only when their inputs change; the memory viewer rewrites only changed rows and snapshots only the visible page; heavy panels refresh at 30 fps on desktop; panels scrolled out of view are skipped. The APU scope's time base is exact again.

**NSF player**

- PAL and Dendy NSFs play at the right pitch and tempo (region from the header or the NSFe `regn` chunk, PAL speed field, region APU tables).
- Correct piano-roll pitch for FDS, VRC7 and Namco 163 (previously fixed C4 for FDS/VRC7, and N163 off by the channel count and reading the wrong register block).
- Multi-chip NSFs play every declared chip, with NSFe `mixe` levels applied.
- NSFe `plst`, `psfx`, `taut`, `text`, `regn`, `mixe`, `VRC7` and `NSF2` chunks are parsed.
- Plain NSFs show elapsed time only; NSFe track times still show a total and fade.

**Cheats**

- Game Genie codes can be named. Click a code in the Cheats list and type a label such as "Start on level 2"; Enter saves, Escape cancels. Names are stored with your per-game cheat list in this browser only and are never sent to multiplayer guests or written into TAS movies.

**Tooling**

- A headless test harness (Node + jsdom) runs the blargg suites, AccuracyCoin, nestest, sample-exact audio hashes, state-hash TAS gates, composite/palette gates and a mapper smoke test, so every change above was verified before shipping.

### v1.0.1

- **PPU "hybrid addresses" accuracy.** A `$2006` (PPUADDR) write that lands in the middle of a background nametable fetch now reproduces the cartridge octal-latch behavior correctly: the read combines the newly written high address byte with the low byte already latched on the bus, instead of using the post-write address wholesale. This fixes the AccuracyCoin **HYBRID ADDRESSES** test, bringing the suite to a perfect 141/141. Normal rendering is byte-for-byte unchanged.
- **Debugger now usable during TAS playback.** The debug panel (memory, registers, OAM, nametable/pattern/palette viewers) stays available while a TAS movie is active rather than being disabled, since those inspectors are read-only. The operations that would desync an active movie (instruction stepping, frame advance, and watch pokes) are individually blocked during playback and point you to the TAS transport instead.
- **No audio stutter when closing a ROM.** The "Close the current ROM?" confirmation now suspends emulation and the audio thread while the dialog is open (matching the existing NSF behavior), so the queued audio tail no longer loops or glitches behind the prompt. Cancelling resumes exactly where you left off.
- **Hotkey display follows the input dropdown.** Switching a player from a gamepad back to Keyboard now reverts the Hotkeys panel to its keyboard bindings immediately, instead of only reverting when the controller is physically disconnected.
- **Mobile layout / safe-area fixes.** Reworked the status-bar height so the bottom safe-area inset is applied exactly once rather than compounded across several rules (fixing excess bottom padding on notched devices), and tightened the mobile toolbar spacing.

- **FDS boot chime pitch.** The embedded clean-room Famicom Disk System BIOS now plays an A#6 to F6 power-on chime in place of the previous B5 to E6. The held second note also rings out with a gentle decay instead of cutting off flat. The change is confined to the BIOS audio routine, and the new base BIOS is fingerprinted automatically, so it validates without any prompt.

## License

KuroganeNES is released under the MIT License (see `LICENSE`). The bundled components (pako, RomPatcher.js, and the embedded fonts) keep their own licenses.
