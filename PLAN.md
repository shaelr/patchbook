# Patchbook — Plan

Patchbook replaces a per-show Excel sheet for managing Blackmagic ATEM and Videohub input/output labels and the show's equipment IP addresses. A small server runs on a Mac (development) or a dedicated Raspberry Pi 4B (production), serves a web UI to Mac and iPad browsers, stores projects, and talks to the hardware over the network.

```
 iPad / Mac browser  ──HTTP──▶  Patchbook server  ──TCP 9990──▶ Videohub
                                (Mac or Pi 4B)    ──UDP 9910──▶ ATEM
```

## Requirements

- **Projects** — create, open, rename, duplicate, delete. Stored on the server, so every device sees the same projects.
- **One ATEM and one Videohub per project**, each optional and independent (no routing/signal-flow tracking between them).
- **Pick a model → layout is generated.** Must support the whole ATEM and Videohub lineups.
- **ATEM:** Name (20 chars) and Label (4 chars), matching ATEM Software Control. **Videohub:** Label.
- **Network table:** device name + IP only, with IP ranges by role.
- **Hardware control:** read labels from, and push labels to, the ATEM and Videohub.
- Works well with touch on iPad.

## Out of scope (for now)

- Videohub → ATEM signal-flow tracking.
- More than one ATEM or Videohub per project.
- Extra columns beyond the existing template.

## Model catalog and detection

1. **Catalog** — a data file in `shared/` listing each model's input/output counts, so a show can be planned offline. Adding a model = adding one entry.
2. **Detect from device** (Phase 2) — both protocols report model and port counts on connect, so the layout can be built from the real hardware, covering models not yet in the catalog.

## IP scheme (default, editable per project)

Assumes a /24 (e.g. `192.168.10.0/24`).

| Range | Role | Size |
|---|---|---|
| .1 | Gateway / Router | 1 |
| .2–.9 | Network Infrastructure (switches, APs) | 8 |
| .10–.19 | Switching & Control (ATEM, ATEM panel, Videohub) | 10 |
| .20–.29 | Spare / Misc | 10 |
| .30–.49 | Record / Playback (HyperDecks) | 20 |
| .50–.59 | Automation (Companion Pi, Patchbook Pi) | 10 |
| .60–.99 | Cameras (CCU, PTZ, PTZ controllers) | 40 |
| .100–.119 | Computers (graphics, playback, presentation) | 20 |
| .120–.149 | Spare | 30 |
| .150–.199 | DHCP Pool (laptops, guests) | 50 |
| .200–.254 | Audio, Comms, Reserved | 55 |

Adding a network device: pick a role → the app suggests the next free IP in that range (manual entry always allowed).

Validation: duplicate IPs, malformed addresses (e.g. leading zeros like `.09`, which some software reads as octal), addresses outside the project subnet.

## Data model

```
Project
├── id, name, notes, subnet, created/updated
├── atem?      { model, ip, inputs[ {n, long, short} ], outputs[ {n, long, short} ] }
├── videohub?  { model, ip, inputs[ {n, label} ], outputs[ {n, label} ] }
└── network[]  { name, ip, role }
```

The ATEM and Videohub appear in the network list automatically (their IP is entered once).

## Phases

### Phase 1 — Replace the spreadsheet ✅
- Projects screen: list, create, open, duplicate, delete.
- ATEM and Videohub tabs: spreadsheet-style label editing, touch-friendly; Tab/Enter moves between cells.
- Auto-generated ATEM Labels (Camera 1 → CAM1), overridable; warnings for over-length Names/Labels.
- Network tab: role ranges, next-free-IP suggestions, validation.
- Import existing `.xlsx` files in the template layout (ATEM / Video Hub / IP tables).
- Export: Excel (same layout as today, plus ATEM Labels), printable sheet (browser Print → PDF), JSON backup/restore.

### Deploy to Pi
- Docker or systemd service on a dedicated Pi 4B (not the Companion Pi). Port 3000.
- Backups: JSON export; recommend running the Pi from a USB SSD.

### Phase 2 — Read from hardware ✅ (ATEM tested on hardware; Videohub awaiting a router)
- Connect to ATEM / Videohub, detect model and port counts, pull current labels.
- Side-by-side diff: project vs. hardware; copy device names into the project (selected or all, optionally switching model).
- Create an ATEM / Videohub in a project directly from a device.
- Connect on demand and disconnect afterwards (ATEM has limited connection slots; Companion holds one).

### Phase 3 — Push to hardware ✅ (ATEM tested on hardware; Videohub awaiting a router)
- From the compare view: send selected differing names → confirm → write → re-read to confirm → Undo for a few seconds.
- Never sends empty or default project names over real device names; blocks Names the ATEM can't take.

### On hold
- **Deploy to the Pi 4B** (dedicated, not the Companion Pi): Node 24, a service that starts on boot, one-command updates from GitHub, automatic project backups (nightly copy and/or "download all projects"), move existing projects over, fixed IP (suggested .51 in Automation). On hold at the user's request — don't start unless asked.

### Future ideas (not planned yet)
Bigger features:
- **Online/offline indicator** per device in the Network tab (a quick check of each IP).
- **HyperDecks** (Ethernet protocol, TCP 9993): read/send names, show status, maybe recording control.
- **Bitfocus Companion**: send source names into Companion button text / custom variables so buttons always match the project.

Smaller ideas that came up along the way:
- **Multiview notes**: a notes field for what's on each (fixed) multiview output, for patch sheets — not ATEM labels.
- **Reset device names to factory**: an explicit, off-by-default option when sending, for cleaning up a switcher after a show (blank/default project names are otherwise never sent).
- **Connection-limit hint**: when an ATEM read times out, mention that the switcher may be out of connection slots (panels, software, Companion).
- **Videohub hardware check**: confirm factory default labels ("Input n" / "Output n") and read/send on a real router.

## Stack

| Part | Choice |
|---|---|
| Server | Node.js 24 LTS + TypeScript, Fastify |
| Storage | SQLite |
| Front end | React + Vite |
| ATEM | `atem-connection` (Sofie / NRK) |
| Videohub | Own client (Blackmagic Videohub Ethernet Protocol, TCP 9990) |
| Excel | `exceljs` |
| Deploy | Docker or systemd on Raspberry Pi OS |

Repo layout: `server/`, `web/`, `shared/` (types + model catalog).
