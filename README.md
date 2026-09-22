# Field Trip Notebook

A phone-first, offline field notebook built with HTML, CSS and vanilla JavaScript. No account, backend, cloud sync, CDN, telemetry, API key or build step. All runtime assets are in this folder. Hosting serves the app; field records never leave your device unless you export them.

## Run locally

From this folder, with Python 3 installed:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open **http://localhost:8000/** in a current browser. Do not double-click `index.html`: service workers and geolocation require HTTPS or localhost. A phone opening a computer's plain HTTP LAN address does not receive the localhost exception; use the HTTPS GitHub Pages site for phone testing.

No installation or compilation is required to run the app. `scripts/create-icons.py` is an optional development tool requiring Pillow; the generated PNG icons are already included.

## Deploy on GitHub Pages

1. Create a GitHub repository (a public repository works with GitHub Free).
2. Commit and push this folder's contents to its `main` branch. `index.html` must be at the repository root, alongside `.nojekyll`, `app.js` and the other files. Do not put field backups in the repository.
3. Open the repository on GitHub → **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select **main** and **/ (root)**, then **Save**.
6. Wait for the Pages deployment to finish. Open the URL shown there, normally `https://USERNAME.github.io/REPOSITORY-NAME/`.
7. On your phone, wait for **Ready for offline use**, install if desired, and perform the airplane-mode test below before leaving for the field.

All asset, manifest and service-worker paths are relative, supporting project repository paths. Each project path has its own database and cache namespace. Changing the hosting domain or project path creates a different notebook storage location: export before moving a deployment.

GitHub's [publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) describe the deployment settings.

## Install on Android

Open the HTTPS site in Chrome. Use the app's **Install app** button if offered, or Chrome's menu → **Add to Home screen / Install app**. Open the installed icon while still online and wait for **Ready for offline use**. Allow location and camera access when prompted. Installation prompts vary by browser.

## Install on iPhone / iPad

Open the HTTPS site in Safari → **Share → Add to Home Screen → Add**. If shown, leave **Open as Web App** enabled. Then **launch from the new Home Screen icon while online**, wait for **Ready for offline use**, and test there.

Start your real notebook in the installed app. Safari and the Home Screen app can have separate data stores; if you already entered records in Safari, export a ZIP there and import it into the installed app. Do not assume records automatically migrate when installing. Apple's [Home Screen instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios) and WebKit's [storage separation explanation](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) provide platform context; see also [Safari 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/) for installation data-copy behavior.

## Field workflow and offline check

The first visit creates an empty trip. Set its title/date; **New field trip** creates additional separate trips, selectable at the top. Every stop stores its own local recording date/time and UTC creation timestamp, so a trip can span multiple days.

Before fieldwork:

1. Load the intended browser or installed app online and wait for **Ready for offline use**.
2. Set a trip title. Press **+ NEW STOP**; the number and time are assigned immediately and GPS starts without blocking notes.
3. Enter a title and notes. Wait for **Saved on this device**. Add a photo via **Take photo** or **Choose images**, and optionally a caption.
4. Allow GPS, or confirm that an unavailable location leaves the notes editor usable. **Retry GPS** tries a fresh high-accuracy fix; a failed retry keeps any previously saved coordinates.
5. Enable airplane mode and explicitly disable Wi-Fi. Close/reopen the app; confirm the shell, stop, notes and photo remain. The small status should say **Offline** (the browser's connectivity hint is not a reachability test).
6. While offline, create Stop 2, write notes, add another photo, and reopen Stop 1. Lock/unlock the phone and switch apps as an additional device test.
7. Export, locate the ZIP in Downloads/Files, and unzip it. Verify both stops in JSON/Markdown and open the photos.
8. Import that ZIP. It should create a separate trip with both stops and their photos, leaving the original intact.

GPS does not require an online map. It does require device location services and permission; a cold satellite fix without network assistance can take longer or fail indoors. Each attempt times out after roughly 30–35 seconds. Move outdoors and retry. Desktop testing cannot establish actual offline GPS or camera behavior on your phone.

## Saving and storage

Trips, stops, notes, captions and image Blobs are in **IndexedDB** in your current browser profile, under this site's origin and project path. Nothing uses localStorage. Photos are resized only when larger than 2000 px on the long side, over 3 MB, or needing format conversion. Resized images are JPEG quality 0.88 with orientation handled by the browser; smaller supported originals remain unchanged. Resize conversion removes original EXIF metadata and can flatten transparency. Unsupported phone formats such as HEIC may need conversion to JPEG first.

Typing immediately queues database writes without a debounce delay. The saved indicator changes only after transactions finish. On save failure, pending text changes remain in memory and **Retry save** appears; do not close that tab until saving succeeds. Failed photo uploads explicitly report how many were saved so you can retry the rest. Stop/photo deletion requires confirmation. Deleted stop numbers are never reused. Imports are validated before one atomic transaction, and always use fresh IDs.

The app requests persistent storage when creating trips/stops, but browsers decide whether to grant it. Storage warnings appear above 200 MB of origin usage or 75% of the estimated quota. Estimates may include other sites under the same origin. Keep individual trips below **500 MB**; this version limits ZIP processing to **512 MB** to bound phone memory use. Very large trips may still exhaust a low-memory phone during export; export regularly and use separate trips for different days.

Browser storage is **not a backup**. Clearing website data, removing a browser/profile, private browsing, device loss, storage pressure or browser eviction can remove records and offline caches. App removal behavior varies by platform. Avoid private/incognito mode. Safari has inactivity-related storage policies; installed Home Screen apps receive different treatment, but installation is not a guarantee against all eviction. See [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) and [tracking prevention](https://webkit.org/tracking-prevention/). Export after each field day and copy the backup to a second device when possible.

Phone operating systems can kill a tab before an in-flight write completes. Wait for the saved indicator and for photo processing to finish before closing. Use one active editor for a trip: writes patch individual fields and stop numbering is transactional, but simultaneous edits to the same field in multiple tabs use last-write-wins. No collaborative sync is provided. Data are not encrypted by this app.

## Export and restore

**EXPORT FIELD TRIP** creates one ZIP entirely on your device, including while offline. Keep the app open until preparation finishes, then verify the download exists. On iOS, use the browser's download/share interface to save it to **Files**; availability and prompts vary by version.

```text
FieldTrip_2026-09-22.zip
└── fieldtrip/
    ├── fieldtrip.json
    ├── fieldtrip.md
    └── photos/
        ├── stop_01_001.jpg
        └── stop_02_001.png
```

Photo extensions match their saved format. JSON uses `schemaVersion: 1`, `exportDate` (UTC ISO 8601), `fieldTrip`, and a `stops` array. Stops contain `number`, `date`, `time`, `timezoneOffsetMinutes` (JavaScript UTC-minus-local convention), `createdAt`, `title`, `notes`, `latitude`, `longitude`, `accuracy` in meters, `gpsTimestamp` (UTC), and `photos` with relative `filename`, `caption`, `mimeType`, original filename and creation time. Missing coordinates are `null`. Coordinates use WGS84 decimal degrees. Notes and captions remain Unicode; note text is preserved in JSON and Markdown for later processing into a LaTeX instructor guide.

**IMPORT FIELD TRIP** accepts the original app-exported ZIP, checks file bounds and CRC32 integrity, validates records, and restores photos and notes into a separate trip after confirmation. Existing data are not overwritten. Re-zipped, encrypted, compressed or third-party ZIP archives are not supported: retain the original export. The local `zip.js` writes standard uncompressed ZIP32 archives readable by normal unzip tools; image formats are already compressed.

A standalone exported `fieldtrip.json` can also be imported (maximum 25 MB). JSON has no image bytes: missing photo references/captions are appended to stop notes after a clear confirmation. Use ZIP for a complete restore. There is no recovery from deletion or lost browser storage unless you kept an export.

## Updates and repository layout

```text
index.html                 Accessible phone-first interface
styles.css                 Local styling and system fonts
app.js                     IndexedDB, notes, GPS, photos, backup/restore
zip.js                     Local ZIP32 writer and checked backup reader
manifest.webmanifest       Install metadata with relative scope
service-worker.js          Versioned, project-scoped app-shell cache
icons/                     SVG source and committed PNG install icons
scripts/create-icons.py    Optional development icon regeneration
tests/                     Development-only automated checks
.nojekyll                  GitHub Pages static-file serving
README.md
```

When changing any runtime file, bump `v1` in `service-worker.js` to a new unique cache version and keep its shell list complete. Installation caches the whole shell atomically. A new worker waits until all old app tabs/windows close before activation; an update notice appears when ready. Activation deletes only this project's old shell caches and never touches IndexedDB. Future database changes must be additive versioned upgrades that preserve user data.

Runtime files make no external requests; network access is used only to download/update this site's own app shell. Documentation links and development tooling are not runtime dependencies.

## Automated verification

For development only, install the test runner (not required to host or use the app):

```sh
npm install --no-save --no-package-lock playwright
node tests/workflow.cjs
```

The test uses installed Microsoft Edge in headless mode, a temporary localhost server with a `/field-notebook/` project subpath, and an isolated browser context. It writes screenshots and a sample backup into ignored `test-results/`. Alternatively, pass an absolute path to an existing Playwright module as the script's first argument. Close the test browser/server if a test is interrupted.

Verified with headless Edge on Windows on 2026-09-22: immediate notes autosave; mocked GPS success and permission denial; photo resizing and unchanged small PNGs; caption/photo persistence after reload; offline startup, stop creation, photo addition and export; JSON/Markdown/image ZIP contents; separate-trip ZIP and JSON import; delete confirmation and sequential numbering; retry after a simulated quota error; corrupted ZIP rejection; isolation between project paths; no external runtime requests; no browser runtime errors. Exported ZIP CRCs, JSON and image dimensions were independently checked with Python's standard `zipfile` module and Pillow. Phone screenshots were visually inspected.

Physical Android/iOS installation, camera access, real satellite GPS, prolonged device suspension and OS storage eviction still require the phone checklist above. Desktop emulation cannot validate those hardware/platform behaviors.
