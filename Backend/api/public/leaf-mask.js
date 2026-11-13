import { makeZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const canvas = (w = 1, h = 1) =>
  Object.assign(document.createElement('canvas'), { width: w, height: h });
const original = $('original'),
  editor = $('editor'),
  mask = canvas(),
  tint = canvas();
const brush = mask.getContext('2d', { willReadFrequently: true });
const photoCanvas = canvas();
const checkIds = ['target', 'foliage', 'background'];
let items = [],
  active = null,
  history = [],
  points = [],
  box = null,
  gesture = null;
let tool = 'paint',
  dirty = false,
  busy = false,
  database;

const blobOf = (c, type = 'image/png') =>
  new Promise((resolve, reject) =>
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      type,
      0.94,
    ),
  );
const textBlob = (data) =>
  new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
const ctx = (c) => c.getContext('2d');
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('drhorticulture-leaf-lab', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function storeRecords(records) {
  if (!database) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('photos', 'readwrite');
    for (const record of records) tx.objectStore('photos').put(record);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
}
function readRecords() {
  return new Promise((resolve, reject) => {
    const request = database.transaction('photos').objectStore('photos').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.created - b.created));
    request.onerror = () => reject(request.error);
  });
}
async function prepareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose an image smaller than 40 MB.');
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1536 / Math.max(image.width, image.height));
    const c = canvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    ctx(c).fillStyle = 'white';
    ctx(c).fillRect(0, 0, c.width, c.height);
    ctx(c).drawImage(image, 0, 0, c.width, c.height);
    return await blobOf(c, 'image/jpeg');
  } finally {
    image.close();
  }
}
async function practice() {
  const c = canvas(640, 750),
    g = ctx(c);
  const gradient = g.createLinearGradient(0, 0, 640, 750);
  gradient.addColorStop(0, '#ebd9a9');
  gradient.addColorStop(1, '#9f845f');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 640, 750);
  g.fillStyle = '#b66b46';
  g.beginPath();
  g.ellipse(316, 465, 131, 127, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#59422e';
  g.beginPath();
  g.ellipse(316, 465, 112, 107, 0, 0, Math.PI * 2);
  g.fill();
  const foliage = [
    [139, 257, -1.0, 159],
    [229, 129, -0.45, 189],
    [371, 133, 0.32, 198],
    [492, 211, 0.73, 187],
    [534, 360, 1.02, 169],
    [118, 430, -1.45, 158],
    [192, 545, -2.03, 126],
    [457, 523, 2.22, 144],
    [291, 259, -0.15, 131],
    [386, 320, 0.8, 133],
  ];
  for (const [x, y, angle, length] of foliage) {
    g.strokeStyle = '#45612d';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(315, 440);
    g.lineTo(x, y);
    g.stroke();
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    const green = g.createLinearGradient(-45, 0, 45, 0);
    green.addColorStop(0, '#2d5636');
    green.addColorStop(0.48, '#78984b');
    green.addColorStop(1, '#3a6338');
    g.fillStyle = green;
    g.beginPath();
    g.moveTo(0, length * 0.52);
    g.bezierCurveTo(-58, 22, -43, -length * 0.28, 0, -length * 0.55);
    g.bezierCurveTo(50, -length * 0.24, 59, 22, 0, length * 0.52);
    g.fill();
    g.strokeStyle = '#a6b65b';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, length * 0.49);
    g.lineTo(0, -length * 0.47);
    g.stroke();
    g.restore();
  }
  return {
    id: 'practice',
    name: 'Practice plant',
    photo: await blobOf(c, 'image/jpeg'),
    practice: true,
  };
}
function queue() {
  $('queue').replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.className = 'queue-item';
    button.textContent = item.name;
    if (active?.id === item.id) button.setAttribute('aria-current', 'true');
    const detail = document.createElement('small');
    detail.textContent = item.practice ? 'Practice only' : item.annotation?.status || 'New';
    button.append(detail);
    button.onclick = () => run(() => open(item));
    $('queue').append(button);
  }
  const accepted = items.filter((item) => item.annotation?.status === 'accepted').length;
  $('count').textContent = String(items.filter((item) => !item.practice).length);
  $('export').disabled = accepted === 0;
  $('export').textContent = accepted ? `↓ Download dataset (${accepted})` : '↓ Download dataset';
}
function markDirty(maskChanged = true) {
  dirty = true;
  $('badge').textContent = 'Unsaved';
  if (maskChanged) for (const id of checkIds) $(id).checked = false;
}
function resetMask() {
  brush.fillStyle = 'black';
  brush.fillRect(0, 0, mask.width, mask.height);
}
function render() {
  if (!active) return;
  const g = ctx(editor);
  g.drawImage(photoCanvas, 0, 0);
  if ($('overlay').checked) {
    const image = brush.getImageData(0, 0, mask.width, mask.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const on = image.data[i] >= 128;
      image.data[i] = 55;
      image.data[i + 1] = 240;
      image.data[i + 2] = 133;
      image.data[i + 3] = on ? 122 : 0;
    }
    ctx(tint).putImageData(image, 0, 0);
    g.drawImage(tint, 0, 0);
  }
  if (box) {
    g.strokeStyle = '#ffe167';
    g.lineWidth = 4;
    g.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  }
  for (const p of points) {
    g.beginPath();
    g.arc(p.x, p.y, 7, 0, 2 * Math.PI);
    g.fillStyle = p.label ? '#0aca67' : '#db3243';
    g.fill();
    g.strokeStyle = 'white';
    g.lineWidth = 2;
    g.stroke();
  }
  $('undo').disabled = !history.length;
  $('clear').disabled = false;
}
function zoom() {
  if (!active) return;
  for (const c of [original, editor]) {
    const fit = Math.min(
      c.parentElement.clientWidth / c.width,
      c.parentElement.clientHeight / c.height,
    );
    const scale = $('zoom').value === 'fit' ? fit : Number($('zoom').value);
    if (scale <= 0) continue;
    c.style.width = `${Math.floor(c.width * scale)}px`;
    c.style.height = `${Math.floor(c.height * scale)}px`;
  }
}
async function open(item) {
  if (dirty && !confirm('Discard unsaved changes to this photo?')) return;
  const img = await createImageBitmap(item.photo);
  try {
    for (const c of [original, editor, mask, tint, photoCanvas]) {
      c.width = img.width;
      c.height = img.height;
    }
    ctx(photoCanvas).drawImage(img, 0, 0);
    ctx(original).drawImage(img, 0, 0);
  } finally {
    img.close();
  }
  resetMask();
  if (item.mask) {
    const image = await createImageBitmap(item.mask);
    try {
      brush.drawImage(image, 0, 0);
    } finally {
      image.close();
    }
  }
  active = item;
  history = [];
  points = [];
  box = null;
  dirty = false;
  $('name').textContent = item.name;
  $('badge').textContent = item.practice ? 'Practice' : item.annotation?.status || 'New';
  if (item.annotation?.reviewer) $('reviewer').value = item.annotation.reviewer;
  $('notes').value = item.annotation?.notes || '';
  $('ndvi').value = item.ndvi ?? '';
  for (const id of checkIds) $(id).checked = !!item.annotation?.checklist?.[id];
  $('save').disabled = $('accept').disabled = $('mask-download').disabled = !!item.practice;
  queue();
  zoom();
  render();
}
function snapshot() {
  history.push(brush.getImageData(0, 0, mask.width, mask.height));
  if (history.length > 10) history.shift();
}
function position(event) {
  const r = editor.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(editor.width - 1, Math.round(((event.clientX - r.left) * editor.width) / r.width)),
    ),
    y: Math.max(
      0,
      Math.min(editor.height - 1, Math.round(((event.clientY - r.top) * editor.height) / r.height)),
    ),
  };
}
function paint(from, to, mode) {
  const size = Number($('brush').value);
  brush.fillStyle = brush.strokeStyle = mode === 'erase' ? 'black' : 'white';
  brush.lineWidth = size;
  brush.lineCap = 'round';
  brush.beginPath();
  brush.moveTo(from.x, from.y);
  brush.lineTo(to.x, to.y);
  brush.stroke();
  brush.beginPath();
  brush.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
  brush.fill();
  render();
}
editor.onpointerdown = (event) => {
  if (!active || busy || gesture || event.button !== 0) return;
  const point = position(event);
  if (tool === 'positive' || tool === 'negative') {
    if (points.length >= 200) return status('Clear prompts before adding more points.', true);
    points.push({ ...point, label: tool === 'positive' ? 1 : 0 });
    render();
    return;
  }
  editor.setPointerCapture(event.pointerId);
  gesture = { pointer: event.pointerId, start: point, last: point, mode: tool };
  if (tool === 'paint' || tool === 'erase') {
    snapshot();
    markDirty();
    paint(point, point, tool);
  }
};
editor.onpointermove = (event) => {
  if (gesture?.pointer !== event.pointerId) return;
  const p = position(event);
  if (gesture.mode === 'box') {
    const a = gesture.start;
    box = [Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x) + 1, Math.max(a.y, p.y) + 1];
    render();
  } else paint(gesture.last, p, gesture.mode);
  gesture.last = p;
};
editor.onpointerup = editor.onpointercancel = (event) => {
  if (gesture?.pointer === event.pointerId) gesture = null;
};
for (const button of document.querySelectorAll('[data-tool]'))
  button.onclick = () => {
    tool = button.dataset.tool;
    for (const other of document.querySelectorAll('[data-tool]'))
      other.setAttribute('aria-pressed', String(other === button));
  };
$('zoom').onchange = zoom;
$('overlay').onchange = render;
$('brush').oninput = () => {
  $('brush-value').textContent = `${$('brush').value} px`;
};
window.addEventListener('resize', zoom);
$('undo').onclick = () => {
  if (history.length) {
    brush.putImageData(history.pop(), 0, 0);
    markDirty();
    render();
  }
};
$('clear').onclick = () => {
  snapshot();
  resetMask();
  markDirty();
  render();
};
$('clear-prompts').onclick = () => {
  points = [];
  box = null;
  render();
};
for (const id of ['reviewer', 'notes', 'ndvi', ...checkIds])
  $(id).oninput = () => {
    if (active && !active.practice) markDirty(false);
  };

function browserSuggestion() {
  const w = mask.width,
    h = mask.height;
  const pixels = ctx(photoCanvas).getImageData(0, 0, w, h).data;
  const [x0, y0, x1, y1] = box || [0, 0, w, h];
  const color = (p) => Array.from(pixels.subarray(4 * (p.y * w + p.x), 4 * (p.y * w + p.x) + 3));
  const positive = points.filter((p) => p.label).map(color);
  const negative = points.filter((p) => !p.label).map(color);
  const result = brush.createImageData(w, h);
  const distance = (r, g, b, [pr, pg, pb]) => (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = 4 * (y * w + x),
        r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      const target = positive.length
        ? Math.min(...positive.map((p) => distance(r, g, b, p)))
        : Infinity;
      const background = negative.length
        ? Math.min(...negative.map((p) => distance(r, g, b, p)))
        : Infinity;
      const green = g > r * 0.95 && 2 * g - r - b > 22 && g > 30;
      if (
        (green || target < 1600) &&
        (negative.length === 0 || background > Math.min(1600, target))
      )
        result.data[i] = 255;
    }
  return result;
}
async function suggest() {
  if (!box && !points.some((p) => p.label))
    throw new Error('Draw a box or add a leaf point first.');
  const proposed = browserSuggestion();
  const current = brush.getImageData(0, 0, mask.width, mask.height);
  const union = $('union').checked;
  for (let i = 0; i < proposed.data.length; i += 4) {
    const value = proposed.data[i] >= 128 || (union && current.data[i] >= 128) ? 255 : 0;
    proposed.data[i] = proposed.data[i + 1] = proposed.data[i + 2] = value;
    proposed.data[i + 3] = 255;
  }
  snapshot();
  brush.putImageData(proposed, 0, 0);
  markDirty();
  render();
  status('Suggestion added. Review its edges and correct it before accepting.');
}
function binaryMask() {
  const c = canvas(mask.width, mask.height),
    g = ctx(c);
  const image = brush.getImageData(0, 0, mask.width, mask.height);
  let foreground = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i] >= 128 ? 255 : 0;
    foreground += value === 255 ? 1 : 0;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  return { canvas: c, foreground };
}
async function save(accept) {
  if (!active || active.practice) return;
  const reviewer = $('reviewer').value.trim();
  const checklist = Object.fromEntries(checkIds.map((id) => [id, $(id).checked]));
  const binary = binaryMask();
  if (accept && (!reviewer || !Object.values(checklist).every(Boolean)))
    throw new Error('Enter a reviewer name and complete all three review checks.');
  if (accept && (!binary.foreground || binary.foreground === mask.width * mask.height))
    throw new Error('An accepted mask must contain both foliage and background.');
  const raw = $('ndvi').value.trim(),
    ndvi = raw === '' ? null : Number(raw);
  if (
    $('ndvi').validity.badInput ||
    (ndvi !== null && (!Number.isFinite(ndvi) || ndvi < 0 || ndvi > 0.99))
  )
    throw new Error('GreenSeeker NDVI must be between 0 and 0.99, or blank.');
  const png = await blobOf(binary.canvas);
  const hash = await crypto.subtle.digest('SHA-256', await png.arrayBuffer());
  const hex = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
  const record = {
    ...active,
    mask: png,
    ndvi,
    annotation: {
      status: accept ? 'accepted' : 'draft',
      reviewer,
      notes: $('notes').value.trim(),
      checklist,
      mask_sha256: hex,
      updated_at: new Date().toISOString(),
    },
  };
  await storeRecords([record]);
  items[items.findIndex((item) => item.id === record.id)] = record;
  active = record;
  dirty = false;
  $('badge').textContent = record.annotation.status;
  queue();
  status(
    accept
      ? 'Mask accepted. It is ready for dataset export.'
      : 'Draft saved. Only accepted masks are exported.',
  );
}
async function exportData() {
  if (dirty) throw new Error('Save or accept the current edits before downloading the dataset.');
  const accepted = items.filter((item) => item.annotation?.status === 'accepted');
  if (!accepted.length) throw new Error('Accept at least one mask first.');
  const manifest = accepted.map((item) => ({ id: item.id, greenseeker_ndvi: item.ndvi ?? null }));
  const files = [['manifest.json', textBlob(manifest)]];
  for (const item of accepted)
    files.push(
      [`${item.id}/photo.jpg`, item.photo],
      [`${item.id}/reviewed.png`, item.mask],
      [
        `${item.id}/annotation.json`,
        textBlob({ ...item.annotation, original_filename: item.name }),
      ],
    );
  download(await makeZip(files), `leaf-training-${new Date().toISOString().slice(0, 10)}.zip`);
  status(
    `Downloaded ${accepted.length} accepted mask${accepted.length === 1 ? '' : 's'} and training manifest.`,
  );
}
async function run(action) {
  if (busy) return;
  busy = true;
  try {
    await action();
  } catch (error) {
    status(error.message || String(error), true);
  } finally {
    busy = false;
  }
}
$('suggest').onclick = () => run(suggest);
$('save').onclick = () => run(() => save(false));
$('accept').onclick = () => run(() => save(true));
$('export').onclick = () => run(exportData);
$('mask-download').onclick = () =>
  run(async () => download(await blobOf(binaryMask().canvas), `${active.id}-mask.png`));
$('upload').onchange = (event) =>
  run(async () => {
    const files = [...event.target.files];
    event.target.value = '';
    const added = [],
      failed = [];
    for (const file of files) {
      try {
        const photo = await prepareImage(file);
        const slug =
          file.name
            .replace(/\.[^.]+$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 45) || 'plant';
        added.push({
          id: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
          name: file.name,
          photo,
          created: Date.now(),
        });
      } catch (error) {
        failed.push(`${file.name}: ${error.message}`);
      }
    }
    await storeRecords(added);
    items.push(...added);
    queue();
    if (added.length && !dirty) await open(added[0]);
    status(
      `Added ${added.length} photo${added.length === 1 ? '' : 's'}.${failed.length ? ' ' + failed.join(' · ') : ''}`,
      !!failed.length,
    );
  });
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function route() {
  const showHelp = location.hash === '#help';
  $('help').hidden = !showHelp;
  $('collect').hidden = showHelp;
  if (!showHelp) zoom();
}
window.addEventListener('hashchange', route);

async function init() {
  let saved = [];
  try {
    database = await openDatabase();
    saved = await readRecords();
  } catch {
    database = null;
    status(
      'Browser storage is unavailable. Download accepted work before closing this page.',
      true,
    );
  }
  items = [await practice(), ...saved];
  await open(saved[0] || items[0]);
  route();
}
init().catch((error) => status(error.message, true));
