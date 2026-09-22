'use strict';
const $ = id => document.getElementById(id);
const DB_NAME = `field-trip-notebook:${new URL('./', location.href).pathname}`;
let db, trip, currentStop, trips = [], photoURLs = [], installPrompt;
let queue = [], saving = null, saveFailure = null, photoBusy = false;
const gpsRequests = new Map();
const pad = n => String(n).padStart(2, '0');
const uid = () => crypto.randomUUID();
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
function showError(error) { $('error').textContent = error.message || String(error); $('error').hidden = false; }
function clearError() { $('error').hidden = true; }
function request(req) { return new Promise((resolve, reject) => {req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);}); }
function complete(tx) { return new Promise((resolve, reject) => {tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || Error('Storage transaction aborted.')); tx.onerror = () => {};}); }
async function openDB() {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    const database = req.result;
    // Additive schema only. Never delete existing stores or records on upgrade.
    if (!database.objectStoreNames.contains('trips')) database.createObjectStore('trips', {keyPath: 'id'});
    if (!database.objectStoreNames.contains('stops')) database.createObjectStore('stops', {keyPath: 'id'}).createIndex('tripId', 'tripId');
    if (!database.objectStoreNames.contains('photos')) {
      const photos = database.createObjectStore('photos', {keyPath: 'id'});
      photos.createIndex('tripId', 'tripId'); photos.createIndex('stopId', 'stopId');
    }
  };
  req.onblocked = () => showError(Error('Close other notebook tabs so local storage can open.'));
  const database = await request(req);
  database.onversionchange = () => {database.close(); showError(Error('A storage upgrade is ready. Close and reopen this app.'));};
  return database;
}
async function records(store, index, key) {
  const tx = db.transaction(store, 'readonly');
  return request(index ? tx.objectStore(store).index(index).getAll(key) : tx.objectStore(store).getAll());
}
async function put(store, value) {
  const tx = db.transaction(store, 'readwrite'), done = complete(tx);
  tx.objectStore(store).put(value); await done;
}
async function patch(store, id, changes) {
  const tx = db.transaction(store, 'readwrite'), done = complete(tx), objectStore = tx.objectStore(store);
  const req = objectStore.get(id);
  req.onsuccess = () => { if (req.result) objectStore.put({...req.result, ...changes, updatedAt: new Date().toISOString()}); };
  await done;
}
function enqueue(job) {
  queue.push(job); $('save-status').textContent = 'Saving locally…';
  drain();
}
function drain() {
  if (saving) return saving;
  saveFailure = null;
  saving = (async () => {
    while (queue.length) {
      try { await queue[0](); queue.shift(); }
      catch (error) {
        saveFailure = error;
        $('save-status').textContent = 'NOT SAVED — retry required';
        showError(Error(`Local save failed: ${error.message}. Your pending edits remain in this tab. Free device storage, then press Retry save. Do not close this tab.`));
        $('retry-save').hidden = false; break;
      }
    }
    if (!queue.length) { $('save-status').textContent = 'Saved on this device'; $('retry-save').hidden = true; }
  })().finally(() => {saving = null;});
  return saving;
}
async function flush() {
  await drain();
  if (queue.length || saveFailure) throw Error('Pending changes could not be saved. Retry saving before continuing.');
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    const button = $(id); button.disabled = true; clearError();
    try { await fn(); } catch (error) {showError(error);} finally {button.disabled = false;}
  });
}
function bindText(id, store, getRecord, field) {
  $(id).addEventListener('input', () => {
    const record = getRecord(); if (!record) return;
    const value = field === 'date' ? ($(id).value || localDate()) : $(id).value; record[field] = value;
    const recordId = record.id;
    // Queue each input immediately: no debounce window that loses the final keystrokes.
    enqueue(() => patch(store, recordId, {[field]: value}));
  });
}
async function refreshTrips(selected) {
  trips = (await records('trips')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('trip-select').replaceChildren(...trips.map(t => new Option(t.title || 'Untitled field trip', t.id)));
  trip = trips.find(t => t.id === selected) || trips[0];
  if (trip) { $('trip-select').value = trip.id; $('trip-title').value = trip.title; $('trip-date').value = trip.date; }
}
async function newTrip() {
  await flush();
  const now = new Date().toISOString();
  const record = {id: uid(), title: 'Untitled field trip', date: localDate(), createdAt: now, updatedAt: now, nextStopNumber: 1};
  await put('trips', record); await refreshTrips(record.id); await showHome(); $('trip-title').focus(); $('trip-title').select();
  requestPersistence();
}
function releasePhotos() { for (const url of photoURLs) URL.revokeObjectURL(url); photoURLs = []; }
async function showHome() {
  await flush(); currentStop = null; releasePhotos();
  await refreshTrips(trip?.id);
  const [stops, photos] = await Promise.all([records('stops', 'tripId', trip.id), records('photos', 'tripId', trip.id)]);
  stops.sort((a, b) => a.number - b.number);
  $('stop-count').textContent = `${stops.length} recorded`;
  $('stop-list').replaceChildren();
  if (!stops.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'Your first stop starts here. Notes and photos save automatically.'; $('stop-list').append(empty); }
  for (const stop of stops) {
    const button = document.createElement('button'); button.className = 'stop';
    const title = document.createElement('strong'); title.textContent = `STOP ${pad(stop.number)} — ${stop.title || 'Untitled stop'}`;
    const summary = document.createElement('small'), count = photos.filter(p => p.stopId === stop.id).length;
    summary.textContent = `${stop.date} · ${stop.time.slice(0, 5)}   ·   ${stop.latitude != null ? 'GPS ✓' : 'No GPS'}   ·   ${count} photo${count === 1 ? '' : 's'}`;
    button.append(title, summary); button.onclick = () => openStop(stop).catch(showError); $('stop-list').append(button);
  }
  $('home').hidden = false; $('editor').hidden = true; await storageStatus();
}
async function createStop() {
  await flush();
  const now = new Date(), id = uid();
  const tx = db.transaction(['trips', 'stops'], 'readwrite'), done = complete(tx);
  let stop;
  const req = tx.objectStore('trips').get(trip.id);
  req.onsuccess = () => {
    const storedTrip = req.result;
    stop = {id, tripId: trip.id, number: storedTrip.nextStopNumber, date: localDate(now), time: localTime(now), timezoneOffsetMinutes: now.getTimezoneOffset(), createdAt: now.toISOString(), updatedAt: now.toISOString(), title: '', notes: '', latitude: null, longitude: null, accuracy: null, gpsTimestamp: null, gpsStatus: 'unavailable'};
    storedTrip.nextStopNumber++; tx.objectStore('trips').put(storedTrip); tx.objectStore('stops').add(stop);
  };
  await done; await openStop(stop); acquireGPS(stop); requestPersistence();
}
async function openStop(stop) {
  await flush();
  const tx = db.transaction('stops', 'readonly');
  stop = await request(tx.objectStore('stops').get(stop.id));
  if (!stop) throw Error('This stop was deleted in another window. Return to the stop list.');
  currentStop = {...stop};
  $('home').hidden = true; $('editor').hidden = false;
  $('stop-heading').textContent = `STOP ${pad(stop.number)}`;
  $('stop-date').textContent = `${stop.date} · ${stop.time.slice(0, 5)}`;
  $('stop-title').value = stop.title; $('stop-notes').value = stop.notes;
  $('photo-choices').hidden = true; $('photo-status').textContent = '';
  renderGPS(); await renderPhotos(); window.scrollTo(0, 0);
}
function renderGPS() {
  if (!currentStop) return;
  const s = currentStop, pending = gpsRequests.has(s.id);
  $('gps-status').textContent = pending ? 'Acquiring location… You can keep writing.' : s.gpsStatus === 'failed' ? (s.latitude != null ? 'GPS unavailable — previous location kept.' : 'GPS unavailable. Retry outdoors with location permission enabled.') : s.latitude != null ? 'Location saved' : 'GPS unavailable';
  $('gps-details').replaceChildren();
  for (const [label, value] of [['Latitude', s.latitude == null ? '—' : s.latitude.toFixed(6)], ['Longitude', s.longitude == null ? '—' : s.longitude.toFixed(6)], ['Accuracy', s.accuracy == null ? '—' : `± ${Math.round(s.accuracy)} m`], ['Time recorded', s.gpsTimestamp ? new Date(s.gpsTimestamp).toLocaleString() : '—']]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; $('gps-details').append(dt, dd);
  }
  $('copy-gps').disabled = s.latitude == null;
}
function acquireGPS(stop) {
  const token = uid(); gpsRequests.set(stop.id, token); renderGPS();
  let finished = false;
  const finish = changes => {
    if (finished || gpsRequests.get(stop.id) !== token) return;
    finished = true; clearTimeout(timer); gpsRequests.delete(stop.id);
    enqueue(() => patch('stops', stop.id, changes));
    if (currentStop?.id === stop.id) {Object.assign(currentStop, changes); renderGPS();}
  };
  const timer = setTimeout(() => finish({gpsStatus: 'failed'}), 35000);
  if (!navigator.geolocation) return finish({gpsStatus: 'failed'});
  try {
    navigator.geolocation.getCurrentPosition(position => {
      finish({latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, gpsTimestamp: new Date(position.timestamp).toISOString(), gpsStatus: 'saved'});
    }, () => finish({gpsStatus: 'failed'}), {enableHighAccuracy: true, timeout: 30000, maximumAge: 0});
  } catch {finish({gpsStatus: 'failed'});}
}
async function copyGPS() {
  const text = `${currentStop.latitude.toFixed(6)}, ${currentStop.longitude.toFixed(6)}`;
  try { await navigator.clipboard.writeText(text); $('gps-status').textContent = 'Coordinates copied'; }
  catch { window.prompt('Copy these coordinates:', text); }
}
async function imageFor(file) {
  // Browser decoding handles phone EXIF orientation before drawing.
  const url = URL.createObjectURL(file), img = new Image();
  try { img.src = url; await img.decode(); return img; }
  catch { throw Error('This image format cannot be opened by this browser. Choose a JPEG, PNG or WebP image.'); }
  finally { URL.revokeObjectURL(url); }
}
async function preparePhoto(file) {
  if (file.size > 80 * 1024 * 1024) throw Error('Image exceeds 80 MB. Choose a smaller copy.');
  if (file.type === 'image/svg+xml' || !file.type.startsWith('image/')) throw Error('Please choose a raster photograph.');
  const img = await imageFor(file), max = Math.max(img.naturalWidth, img.naturalHeight);
  if (!max) throw Error('This image has no readable dimensions.');
  const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
  if (max <= 2000 && file.size <= 3 * 1024 * 1024 && supported.includes(file.type)) return file;
  const scale = Math.min(1, 2000 / max), canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext('2d'); if (!context) throw Error('Image resizing is unavailable.');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
  canvas.width = canvas.height = 1;
  if (!blob) throw Error('Could not resize image. Try a smaller image.');
  return blob;
}
async function addPhotos(files) {
  if (!currentStop || photoBusy) return;
  photoBusy = true; const stop = {...currentStop}; $('add-photo').disabled = true; $('back').disabled = true; $('delete-stop').disabled = true;
  let added = 0;
  try {
    for (const file of files) {
      $('photo-status').textContent = `Saving photo ${added + 1} of ${files.length}…`;
      const blob = await preparePhoto(file);
      await put('photos', {id: uid(), tripId: stop.tripId, stopId: stop.id, blob, mimeType: blob.type, caption: '', originalName: file.name, createdAt: new Date().toISOString()});
      added++;
    }
    $('photo-status').textContent = `${added} photo${added === 1 ? '' : 's'} saved on this device.`;
  } catch (error) {showError(Error(`${added} photo(s) saved. ${error.message} The failed photo was not saved; try again.`)); $('photo-status').textContent = `${added} photo(s) saved; please retry remaining images.`;}
  finally {
    photoBusy = false; $('add-photo').disabled = false; $('back').disabled = false; $('delete-stop').disabled = false;
    $('photo-file').value = ''; $('camera-file').value = ''; await renderPhotos(); await storageStatus();
  }
}
async function renderPhotos() {
  if (!currentStop) return;
  const stopId = currentStop.id, photos = (await records('photos', 'stopId', stopId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (currentStop?.id !== stopId) return;
  releasePhotos(); $('photos').replaceChildren(); $('photo-count').textContent = String(photos.length);
  for (const photo of photos) {
    const url = URL.createObjectURL(photo.blob); photoURLs.push(url);
    const card = document.createElement('div'); card.className = 'photo';
    const preview = document.createElement('button'); preview.className = 'preview'; preview.setAttribute('aria-label', 'View photo larger');
    const img = document.createElement('img'); img.src = url; img.alt = photo.caption || 'Field photograph'; img.loading = 'lazy'; preview.append(img);
    preview.onclick = () => { $('large-photo').src = url; $('large-caption').textContent = caption.value; $('photo-view').showModal(); };
    const label = document.createElement('label'); label.textContent = 'Caption (optional)'; label.htmlFor = `caption-${photo.id}`;
    const caption = document.createElement('input'); caption.id = label.htmlFor; caption.value = photo.caption; caption.maxLength = 2000;
    caption.oninput = () => { const value = caption.value; enqueue(() => patch('photos', photo.id, {caption: value})); };
    const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = 'Delete photo';
    remove.onclick = async () => {
      if (!confirm('Delete this photo permanently from this device? Export a backup first if you need a copy.')) return;
      try {await flush(); const tx = db.transaction('photos', 'readwrite'), done = complete(tx); tx.objectStore('photos').delete(photo.id); await done; await renderPhotos();} catch (error) {showError(error);}
    };
    card.append(preview, label, caption, remove); $('photos').append(card);
  }
}
async function deleteStop() {
  if (!confirm(`Permanently delete Stop ${pad(currentStop.number)} and all its photos? This cannot be undone without a backup.`)) return;
  await flush(); const id = currentStop.id; gpsRequests.delete(id);
  const tx = db.transaction(['stops', 'photos'], 'readwrite'), done = complete(tx);
  tx.objectStore('stops').delete(id);
  const cursor = tx.objectStore('photos').index('stopId').openCursor(IDBKeyRange.only(id));
  cursor.onsuccess = () => {if (cursor.result) {cursor.result.delete(); cursor.result.continue();}};
  await done; await showHome();
}
async function snapshot() {
  await flush();
  const tx = db.transaction(['trips', 'stops', 'photos'], 'readonly'), done = complete(tx);
  const values = await Promise.all([request(tx.objectStore('trips').get(trip.id)), request(tx.objectStore('stops').index('tripId').getAll(trip.id)), request(tx.objectStore('photos').index('tripId').getAll(trip.id))]);
  await done; return values;
}
const extensions = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif'};
const inline = text => String(text).replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}\[\]<>#|])/g, '\\$1');
async function exportTrip() {
  $('export').textContent = 'PREPARING BACKUP…';
  try {
    const [savedTrip, stops, photos] = await snapshot();
    if (photos.reduce((sum, p) => sum + p.blob.size, 0) > 500 * 1024 * 1024) throw Error('Trip photos exceed the 500 MB backup limit. Please keep individual trips below 500 MB.');
    const entries = [], data = {schemaVersion: 1, app: 'Field Trip Notebook', exportDate: new Date().toISOString(), fieldTrip: {title: savedTrip.title, date: savedTrip.date, createdAt: savedTrip.createdAt, nextStopNumber: savedTrip.nextStopNumber}, stops: []};
    const md = [`# Field Trip: ${inline(savedTrip.title)}`, '', `**Trip date:** ${savedTrip.date}`, `**Exported:** ${data.exportDate}`, '', 'Coordinates use WGS84 decimal degrees. Stop date/time are local to recording; GPS timestamps are UTC.', ''];
    for (const stop of stops.sort((a, b) => a.number - b.number)) {
      const exported = {...stop, photos: []}; delete exported.id; delete exported.tripId;
      const attached = photos.filter(p => p.stopId === stop.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      for (const [i, photo] of attached.entries()) {
        const filename = `photos/stop_${pad(stop.number)}_${String(i + 1).padStart(3, '0')}.${extensions[photo.mimeType] || 'jpg'}`;
        exported.photos.push({filename, caption: photo.caption, mimeType: photo.mimeType, createdAt: photo.createdAt, originalName: photo.originalName});
        entries.push({name: `fieldtrip/${filename}`, data: photo.blob});
      }
      data.stops.push(exported);
      md.push(`## Stop ${pad(stop.number)} — ${inline(stop.title || 'Untitled stop')}`, '', `**Date:** ${stop.date}`, `**Time:** ${stop.time}`, `**Coordinates:** ${stop.latitude == null ? 'Not recorded' : `${stop.latitude}, ${stop.longitude}`}`, `**GPS accuracy:** ${stop.accuracy == null ? 'Not recorded' : `±${stop.accuracy} m`}`, `**GPS timestamp (UTC):** ${stop.gpsTimestamp || 'Not recorded'}`, '', '### Notes', '', stop.notes || '(No notes)', '', '### Photos', '', ...exported.photos.map(p => `* ${p.filename}${p.caption ? ` — ${inline(p.caption)}` : ''}`), '', '---', '');
    }
    entries.unshift({name: 'fieldtrip/fieldtrip.json', data: JSON.stringify(data, null, 2)}, {name: 'fieldtrip/fieldtrip.md', data: md.join('\n')});
    const blob = await FieldZip.create(entries), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `FieldTrip_${savedTrip.date || localDate()}.zip`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
    $('save-status').textContent = 'Backup prepared — verify it in Downloads / Files';
  } finally {$('export').textContent = 'EXPORT FIELD TRIP';}
}
function validateBackup(data) {
  if (data?.schemaVersion !== 1 || !data.fieldTrip || !Array.isArray(data.stops)) throw Error('Unsupported backup format. Use a Field Trip Notebook version 1 export.');
  const string = (value, name, limit = 10000000) => {if (typeof value !== 'string' || value.length > limit) throw Error(`Invalid ${name} in backup.`);};
  string(data.fieldTrip.title, 'trip title', 300); string(data.fieldTrip.date, 'trip date', 10);
  if (data.fieldTrip.nextStopNumber != null && (!Number.isSafeInteger(data.fieldTrip.nextStopNumber) || data.fieldTrip.nextStopNumber < 1 || data.fieldTrip.nextStopNumber > 1000001)) throw Error('Invalid next stop number.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fieldTrip.date)) throw Error('Invalid trip date.');
  if (data.stops.length > 10000) throw Error('Too many stops in backup.');
  const numbers = new Set(), filenames = new Set();
  for (const s of data.stops) {
    if (!Number.isSafeInteger(s.number) || s.number < 1 || s.number > 1000000 || numbers.has(s.number)) throw Error('Invalid or duplicate stop number.');
    numbers.add(s.number);
    string(s.title, 'stop title', 300); string(s.notes, 'notes'); string(s.date, 'stop date', 10); string(s.time, 'stop time', 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(s.time)) throw Error('Invalid stop date/time.');
    for (const [key, min, max] of [['latitude', -90, 90], ['longitude', -180, 180], ['accuracy', 0, 1e9]]) if (s[key] != null && (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)) throw Error(`Invalid GPS ${key}.`);
    if ((s.latitude == null) !== (s.longitude == null)) throw Error('Incomplete coordinate pair.');
    if (s.gpsTimestamp != null && (typeof s.gpsTimestamp !== 'string' || !Number.isFinite(Date.parse(s.gpsTimestamp)))) throw Error('Invalid GPS timestamp.');
    if (!Array.isArray(s.photos)) throw Error('Missing photo list.');
    for (const p of s.photos) {
      string(p.filename, 'photo filename', 200); string(p.caption, 'caption', 2000);
      if (!/^photos\/stop_\d+_\d+\.(jpg|png|webp|gif|avif)$/.test(p.filename) || filenames.has(p.filename) || !extensions[p.mimeType]) throw Error('Invalid photo metadata.');
      filenames.add(p.filename);
    }
  }
}
async function importTrip(file) {
  await flush(); if (!file) return;
  if (file.size > 512 * 1024 * 1024) throw Error('Backup exceeds 512 MB.');
  let files = null, data;
  if (file.name.toLowerCase().endsWith('.zip')) {
    files = await FieldZip.read(file);
    const json = files.get('fieldtrip/fieldtrip.json'); if (!json) throw Error('No fieldtrip/fieldtrip.json found in backup.');
    data = JSON.parse(await json.text());
  } else { if (file.size > 25 * 1024 * 1024) throw Error('JSON exceeds 25 MB.'); data = JSON.parse(await file.text()); }
  validateBackup(data);
  const count = data.stops.reduce((n, s) => n + s.photos.length, 0);
  if (files) for (const s of data.stops) for (const p of s.photos) if (!files.has(`fieldtrip/${p.filename}`)) throw Error(`Missing photo: ${p.filename}. Nothing was imported.`);
  if (!confirm(`Import “${data.fieldTrip.title}” as a NEW field trip with ${data.stops.length} stops? Existing trips will remain unchanged.${!files && count ? `\n\nThis JSON references ${count} photos, but JSON does not contain image files. Photo references and captions will be appended to notes; import the ZIP to restore images.` : ''}`)) return;
  const now = new Date().toISOString(), tripId = uid(), importedPhotos = [], importedStops = [];
  for (const s of data.stops) {
    const stopId = uid(); let notes = s.notes;
    if (!files && s.photos.length) notes += '\n\n[Photos not restored from JSON]\n' + s.photos.map(p => `${p.filename} — ${p.caption}`).join('\n');
    importedStops.push({id: stopId, tripId, number: s.number, title: s.title, notes, date: s.date, time: s.time, timezoneOffsetMinutes: Number.isFinite(s.timezoneOffsetMinutes) ? s.timezoneOffsetMinutes : null, createdAt: s.createdAt || now, updatedAt: now, latitude: s.latitude ?? null, longitude: s.longitude ?? null, accuracy: s.accuracy ?? null, gpsTimestamp: s.gpsTimestamp ?? null, gpsStatus: s.latitude == null ? 'unavailable' : 'saved'});
    if (files) for (const p of s.photos) {
      const blob = files.get(`fieldtrip/${p.filename}`).slice(0, undefined, p.mimeType);
      await imageFor(blob); // Reject unreadable photos before the atomic database import.
      importedPhotos.push({id: uid(), tripId, stopId, blob, mimeType: p.mimeType, caption: p.caption, originalName: p.originalName || p.filename, createdAt: typeof p.createdAt === 'string' ? p.createdAt : now});
    }
  }
  const next = Math.max(0, ...data.stops.map(s => s.number)) + 1;
  const tx = db.transaction(['trips', 'stops', 'photos'], 'readwrite'), done = complete(tx);
  tx.objectStore('trips').add({id: tripId, title: `${data.fieldTrip.title}`.slice(0, 300), date: data.fieldTrip.date, createdAt: now, updatedAt: now, nextStopNumber: Math.max(next, Number.isSafeInteger(data.fieldTrip.nextStopNumber) ? data.fieldTrip.nextStopNumber : next)});
  for (const stop of importedStops) tx.objectStore('stops').add(stop);
  for (const photo of importedPhotos) tx.objectStore('photos').add(photo);
  await done; await refreshTrips(tripId); await showHome(); $('save-status').textContent = 'Backup imported as a separate trip';
}
async function requestPersistence() { try {if (navigator.storage?.persist) await navigator.storage.persist();} catch {} }
async function storageStatus() {
  try {
    if (!navigator.storage?.estimate) return;
    const {usage = 0, quota = 0} = await navigator.storage.estimate();
    const large = usage > 200 * 1024 * 1024 || (quota > 0 && usage / quota > .75);
    $('storage-warning').hidden = !large;
    $('storage-warning').textContent = `Browser storage is using about ${Math.round(usage / 1048576)} MB${quota ? ` of ${Math.round(quota / 1048576)} MB available quota` : ''}. Export a backup now. Keep individual trips below 500 MB for ZIP export.`;
  } catch {}
}
async function setupOffline() {
  if (!('serviceWorker' in navigator)) { $('offline-status').textContent = 'Offline startup unavailable — use HTTPS / localhost'; return; }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    $('offline-status').textContent = 'Ready for offline use';
    const update = () => {if (registration.waiting) $('offline-status').textContent = 'Update ready — close all app windows to apply';};
    update(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', update));
  } catch (error) { $('offline-status').textContent = 'Offline setup failed — reconnect and reload'; showError(error); }
}
async function init() {
  const retry = document.createElement('button'); retry.id = 'retry-save'; retry.textContent = 'Retry save'; retry.hidden = true; $('error').after(retry);
  action('retry-save', async () => {await flush(); clearError();});
  const network = () => {$('network').textContent = navigator.onLine ? 'Online' : 'Offline';}; network(); addEventListener('online', network); addEventListener('offline', network);
  bindText('trip-title', 'trips', () => trip, 'title'); bindText('trip-date', 'trips', () => trip, 'date');
  bindText('stop-title', 'stops', () => currentStop, 'title'); bindText('stop-notes', 'stops', () => currentStop, 'notes');
  action('new-trip', newTrip); action('new-stop', createStop); action('back', showHome); action('retry-gps', () => acquireGPS(currentStop)); action('copy-gps', copyGPS); action('delete-stop', deleteStop); action('export', exportTrip);
  action('add-photo', () => {$('photo-choices').hidden = !$('photo-choices').hidden;});
  action('take-photo', () => $('camera-file').click()); action('choose-photo', () => $('photo-file').click());
  for (const id of ['photo-file', 'camera-file']) $(id).onchange = () => addPhotos(Array.from($(id).files)).catch(showError);
  action('close-photo', () => {$('photo-view').close(); $('large-photo').removeAttribute('src');});
  action('import', () => $('import-file').click());
  $('import-file').onchange = async () => { $('import').disabled = true; try {await importTrip($('import-file').files[0]);} catch (error) {showError(error);} finally {$('import').disabled = false; $('import-file').value = '';} };
  $('trip-select').onchange = async () => {try {await flush(); trip = trips.find(t => t.id === $('trip-select').value); await showHome();} catch (error) {showError(error);}};
  addEventListener('beforeunload', event => {if (queue.length || photoBusy) {event.preventDefault(); event.returnValue = '';}});
  document.addEventListener('visibilitychange', () => {if (document.visibilityState === 'hidden') drain();});
  addEventListener('beforeinstallprompt', event => {event.preventDefault(); installPrompt = event; $('install').hidden = false;});
  action('install', async () => {if (installPrompt) {await installPrompt.prompt(); installPrompt = null; $('install').hidden = true;}});
  setupOffline();
  try { db = await openDB(); await refreshTrips(); if (!trip) await newTrip(); else await showHome(); $('save-status').textContent = 'Saved on this device'; }
  catch (error) { $('save-status').textContent = 'Storage unavailable'; showError(Error(`Cannot open local notebook storage: ${error.message}. Use a normal browser window with storage enabled; do not clear existing site data.`)); }
}
init();
