# Patchbook

Show prep for Blackmagic gear: plan ATEM and Videohub input/output labels and your equipment IP addresses per project, then read the names from your ATEM or Videohub, compare, and send the labels straight to the hardware.

Runs as a small server on a Mac or Raspberry Pi; use it from any browser on the network, including iPad.

## Features

- Projects you can create, duplicate, back up and restore
- Pick an ATEM or Videohub model and get its full input/output list (Custom counts for anything else)
- ATEM Names (20 characters) and Labels (4 characters, generated from the Name unless you set one); Videohub Labels
- Read names from an ATEM or Videohub, compare them with the project, copy them in, or send your names to the device (with Undo)
- Network list with IP ranges by role, next-free-address suggestions, and checks for duplicates, typos and out-of-subnet addresses
- Import your existing Excel sheets; export to Excel, a printable sheet (or PDF), or a JSON backup
- Works on Mac, iPad and phone browsers, with touch-friendly editing

## Running it

Requires [Node.js 24](https://nodejs.org) or newer.

```bash
npm install
npm run build
npm start
```

Open `http://<computer-ip>:3000` from any device on the same network. Projects are stored in `~/Library/Application Support/Patchbook/` on a Mac, and in the project's `data/` folder elsewhere (set `PATCHBOOK_DATA` to choose another folder).

For development, `npm run dev` runs the server and a live-reloading UI at `http://localhost:5173`.

### Mac menu bar app

Download **Patchbook-<version>-mac.zip** from [Releases](https://github.com/shaelr/patchbook/releases), unzip it and move **Patchbook.app** to Applications. It includes everything it needs (no Node.js install required) and runs on Apple silicon and Intel Macs with macOS 13 or later.

The app isn't signed by an Apple developer account yet, so the first time you open it macOS blocks it: open **System Settings › Privacy & Security**, scroll down and click **Open Anyway** next to the Patchbook message, then confirm.

To build and install it from this folder instead:

```bash
npm run mac:app
```

Builds **Patchbook.app** and installs it in Applications. Open it and Patchbook runs from the menu bar: it starts the server, shows the address to use on an iPad or phone, can start at login, and stops the server when you quit. A locally built app runs Patchbook from this project folder, so leave the folder in place, and re-run `npm run mac:app` after updating. `npm run mac:release` builds the self-contained app and zip that go on a release. Logs go to `~/Library/Logs/Patchbook.log`.

See [PLAN.md](PLAN.md) for the roadmap.
