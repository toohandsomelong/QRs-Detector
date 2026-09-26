# NOTICE
THIS IS VIBE CODED
I VIBE CODED THIS SO I CAN REST WHILE THEY ARE FORCED ME TO ATTEND
# QR Watcher

Watches your screen, scans for QR codes every minute, and plays a loud alarm when a
new QR appears — so it can wake you up. Once you acknowledge a QR, it stays silent
for that QR. If the QR leaves the screen for a while, the watcher re-arms, so the
next time it shows up you get woken again.

Built for Windows (uses PowerShell for screen capture and the alarm sound).

## Requirements

- Windows
- [Node.js](https://nodejs.org/) 18 or newer

## Install

```bash
npm install
```

## Run

Open a **real console window** (the press-key acknowledge needs a terminal) and run:

```bash
npm start
```

The default behavior:

- Scan the **primary monitor** every **60 seconds**.
- If a QR code appears that you have not acknowledged, play
  `C:\Windows\Media\Alarm01.wav` in a loop until you press a key.
- **Press any key** to stop the alarm and mark that QR as acknowledged.
- A marked QR is ignored while it stays on screen. Once it has been **off-screen
  for 60 seconds**, it is "re-armed" and will alarm again next time it appears.
- Press `Ctrl+C` to quit.

## Options

| Option | Description |
| --- | --- |
| `--interval <seconds>` | How often to scan. Default `60`. |
| `--rearm-after <sec>` | Re-arm a marked QR after it has been off-screen this long. Default `60`. |
| `--permanent` | Never re-arm. A marked QR is ignored forever. |
| `--screen <id>` | Scan one display by id (see `--list-screens`). |
| `--all-screens` | Scan every display instead of just the primary. |
| `--list-screens` | Print display ids and exit. |
| `--clear-marks` | Empty `marked.json` and exit (stop the watcher first). |
| `--wav <path>` | Sound file to loop for the alarm. |
| `--force-volume` | Set system volume to 100% and unmute on start. |
| `--no-force-volume` | Do not touch system volume (default). |
| `--help` | Show help. |

Examples:

```bash
# scan every 30s, re-arm after 2 minutes
npm start -- --interval 30 --rearm-after 120

# scan every monitor
npm start -- --all-screens

# ignore a QR forever after acknowledging it
npm start -- --permanent
```

## Test it

Generate a test QR image and open it on screen:

```bash
npm run test-qr
```

Then run the watcher — it should detect `HELLO-WATCHER-TEST-123` and start the alarm.
Press a key to stop it.

## How it works

1. Take a screenshot of the display(s) on each scan.
2. Decode all QR codes found (grayscale + upscale helps read dense QR codes with a logo).
3. Compute a hash of each decoded QR's text. This is the QR's identity.
4. If a QR's hash is not marked, start the alarm loop.
5. Pressing a key stops the alarm and marks the QR in `marked.json`.
6. `marked.json` remembers acknowledged QRs. With re-arm enabled (default), a mark
   is removed once the QR has been off-screen long enough.

## Files

- `watcher.js` — main program.
- `scripts/alarm.ps1` — loops the alarm sound.
- `scripts/max-volume.ps1` — sets volume to 100% (used by `--force-volume`).
- `marked.json` — acknowledged QR codes (created automatically).
- `tools/make-test-qr.js` — generates `test-qr.png`.

## Notes

- Run it in a real console window. In a non-interactive shell the press-key
  acknowledge is disabled.
- The alarm loudness depends on your system volume. Use `--force-volume` to raise it
  to 100% automatically.
- If the screen shows the same link as a previous session (for example a recycled
  Google Forms link), the hash is the same. That is why re-arm exists.
