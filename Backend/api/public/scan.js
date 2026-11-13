import { scanState } from './scan-state.js';

const element = (id) => document.getElementById(id);
const status = element('status');
let state = (await scanState()) ?? {};

function save(fields) {
  state = { ...state, ...fields };
  return scanState(state);
}
const recommendations = {
  fertilize: 'Fertilize',
  do_not_fertilize: 'Do not fertilize',
  abstain: 'No fertilizer recommendation',
};

async function requestScan(path, options) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(150_000) });
  return { ok: response.ok, body: await response.json() };
}

function errorMessage(error) {
  return error.name === 'TimeoutError'
    ? 'The scan took too long. Check Scan details before retrying if you have a scan ID.'
    : 'Could not reach the scan service. Try again.';
}

function initializeUpload(form) {
  const fileInput = form.elements.image;
  const preview = element('preview');
  const submit = element('submit');
  const startNew = element('new-scan');
  const note = element('retake-note');
  const result = element('scan-result');
  const hints = element('hints');
  const details = element('details-link');
  let previewUrl;
  let retakeId;

  function setRetake(scanId) {
    retakeId = scanId;
    note.hidden = startNew.hidden = !scanId;
    note.textContent = scanId ? 'Choose a new photo to retake this scan.' : '';
    submit.textContent = scanId ? 'Analyze retake' : 'Analyze photo';
  }

  function clearResult() {
    result.hidden = details.hidden = hints.hidden = true;
    hints.replaceChildren();
  }

  function showPreview(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.hidden = !file;
    if (file) {
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
    } else {
      previewUrl = undefined;
      preview.removeAttribute('src');
    }
  }

  function render() {
    showPreview(state.photo);
    clearResult();
    const { submission, scanId, photo } = state;
    submit.disabled = !photo;
    setRetake(state.retakeId);
    startNew.hidden = !photo && !scanId;
    element('selected-file').textContent = photo?.name ?? '';
    if (scanId) {
      details.href = `/ImageData.html?scan_id=${encodeURIComponent(scanId)}`;
      details.textContent = `View scan ${scanId}`;
      details.hidden = false;
    }
    status.textContent = photo ? 'Photo ready to analyze.' : 'Choose a photo to begin.';
    if (submission) {
      const { ok, body } = submission;
      if (!ok) {
        status.textContent = body.error?.message ?? 'The scan could not be completed.';
        for (const hint of body.error?.details?.hints ?? []) {
          const item = document.createElement('li');
          item.textContent = hint;
          hints.append(item);
        }
        hints.hidden = !hints.childElementCount;
        return;
      }
      const reading = body.result;
      const hasReading = Number.isFinite(reading?.ndvi);
      status.textContent = hasReading ? 'Analysis complete.' : 'Estimated NDVI is unavailable.';
      if (hasReading) {
        element('ndvi').textContent = reading.ndvi.toFixed(3);
        element('advice').textContent = recommendations[reading.recommendation] ?? '';
        result.hidden = false;
      }
      if (body.status === 'abstained' && reading?.abstain_reason) {
        const item = document.createElement('li');
        item.textContent = describeAbstention(reading);
        hints.append(item);
        hints.hidden = false;
      }
    }
  }

  fileInput.addEventListener('change', () => {
    const photo = fileInput.files[0];
    if (!photo) return;
    void save({ photo, submission: undefined });
    render();
  });
  startNew.addEventListener('click', () => {
    form.reset();
    void save({
      photo: undefined,
      submission: undefined,
      scanId: undefined,
      retakeId: undefined,
      lastViewedId: undefined,
      rejection: undefined,
    });
    render();
    fileInput.focus();
  });
  render();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const photo = state.photo;
    if (!photo || submit.disabled) return;
    submit.disabled = fileInput.disabled = startNew.disabled = true;
    clearResult();
    status.textContent = 'Analyzing your photo…';
    try {
      const data = new FormData();
      data.set('image', photo);
      const path = retakeId
        ? `/api/v1/scans/${encodeURIComponent(retakeId)}/images`
        : '/api/v1/scans';
      const { ok, body } = await requestScan(path, { method: 'POST', body: data });
      const scanId = body.scan_id ?? body.error?.scan_id ?? retakeId;
      const rejection =
        body.error?.code === 'IMAGE_REJECTED' ? { scanId, details: body.error.details } : undefined;
      const { status: scanStatus, result, error } = body;
      await save({
        scanId,
        lastViewedId: scanId,
        submission: { ok, body: { status: scanStatus, result, error } },
        rejection,
        retakeId: !ok
          ? (body.error?.scan_id ?? retakeId)
          : body.status === 'abstained'
            ? scanId
            : undefined,
      });
      render();
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      submit.disabled = fileInput.disabled = startNew.disabled = false;
    }
  });
}

const metricLabels = {
  short_side_px: 'Short side (px)',
  mean_luminance: 'Photo brightness',
  clipped_pct: 'Photo highlights clipped (%)',
  laplacian_var: 'Sharpness score',
  leaf_mean_luminance: 'Leaf brightness',
  leaf_clipped_pct: 'Leaf highlights clipped (%)',
};

const scanStatuses = {
  completed: 'Completed',
  rejected: 'Photo rejected',
  abstained: 'No fertilizer recommendation',
  failed: 'Analysis failed',
  processing: 'Processing',
};

const abstainReasons = {
  low_mask_confidence: 'The model was unsure which pixels belonged to the leaves.',
  low_confidence: 'The NDVI estimate was below the confidence required for a recommendation.',
};

const readable = (code) =>
  code.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : null);
const ndvi = (value) => (Number.isFinite(value) ? value.toFixed(3) : null);
const uncalibratedModels = new Set(['LeafSegmenter v1.0.0', 'LeafSegmenter v1.1.0']);

function confidenceDisplay(value, modelVersion) {
  if (uncalibratedModels.has(modelVersion) && value === 0) return 'Not calibrated';
  return percent(value);
}

function describeAbstention({ abstain_reason: reason, model_version: modelVersion, confidence }) {
  if (uncalibratedModels.has(modelVersion) && confidence === 0) {
    if (reason === 'low_mask_confidence') {
      return 'The model found leaves, but this version does not provide a calibrated leaf mask confidence score.';
    }
    if (reason === 'low_confidence') {
      return 'This model version does not provide a calibrated confidence score for its NDVI estimate.';
    }
  }
  return reason ? (abstainReasons[reason] ?? readable(reason)) : 'No reason was reported.';
}

function renderDecision(scan) {
  const quality = scan.image?.quality;
  const cached = state.rejection?.scanId === scan.scan_id ? state.rejection.details : null;
  const rows = [];
  let title;
  if (scan.status === 'rejected') {
    title = 'Why the photo was rejected';
    const reasons =
      quality?.rejection_reasons ??
      cached?.reasons?.map((code, index) => ({
        message: readable(code),
        hint: cached.hints?.[index],
      })) ??
      [];
    rows.push(...reasons.map(({ message, hint }) => [message, hint]));
    if (!rows.length)
      rows.push(['The connected API did not provide a rejection reason for this scan.']);
  } else if (scan.status === 'abstained') {
    title = 'Why there is no recommendation';
    rows.push([describeAbstention(scan.result ?? {})]);
  } else if (scan.status === 'failed') {
    title = 'Why there is no result';
    rows.push(['Analysis did not finish.', 'Try analyzing a new photo or retry the scan.']);
  }
  element('decision-title').textContent = title ?? '';
  const list = element('decision-reasons');
  list.replaceChildren();
  for (const [message, hint] of rows) {
    const item = document.createElement('li');
    item.textContent = hint ? `${message} ${hint}` : message;
    list.append(item);
  }
  element('decision-details').hidden = rows.length === 0;
}

function renderFacts(container, fields) {
  container.replaceChildren();
  for (const [label, value] of fields) {
    if (value == null) continue;
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.textContent = label;
    definition.textContent = value;
    container.append(term, definition);
  }
}

function initializeLookup(form) {
  const button = form.querySelector('button');
  const image = element('stored-image');
  const panel = element('scan-details');
  async function load(scanId) {
    if (!scanId || button.disabled) return;
    button.disabled = true;
    panel.hidden = image.hidden = true;
    image.removeAttribute('src');
    status.textContent = 'Looking up scan…';
    try {
      const { ok, body } = await requestScan(`/api/v1/scans/${encodeURIComponent(scanId)}`);
      if (!ok) {
        status.textContent = body.error?.message ?? 'Could not find the scan.';
        return;
      }
      const quality = body.image?.quality;
      const result = body.result;
      const diagnostics = body.diagnostics;
      const modelVersion = result?.model_version ?? diagnostics?.model_version;
      const created = new Date(body.created_at);
      const { id, width, height, mime_type: type } = body.image ?? {};
      renderFacts(element('facts'), [
        ['Scan ID', body.scan_id],
        ['Status', scanStatuses[body.status] ?? body.status],
        [
          'Scan created',
          body.created_at && Number.isFinite(created.getTime()) ? created.toLocaleString() : null,
        ],
        ['Photo ID', id],
        ['Resolution', width && height ? `${width} × ${height} px` : null],
        ['Image format', type],
        [
          'Photo quality',
          quality?.passed === true
            ? 'Passed'
            : quality?.passed === false
              ? 'Rejected'
              : 'Unavailable',
        ],
      ]);
      renderDecision(body);
      element('estimate-details').hidden = !result && !diagnostics;
      renderFacts(element('estimate-facts'), [
        ['Estimated NDVI', result ? (ndvi(result.ndvi) ?? 'Unavailable') : null],
        ['Recommendation', recommendations[result?.recommendation]],
        ['Model confidence', confidenceDisplay(result?.confidence, modelVersion)],
        ['Leaf mask confidence', confidenceDisplay(diagnostics?.mask_confidence, modelVersion)],
        ['Photo covered by leaf mask', percent(diagnostics?.leaf_fraction)],
        [
          'Inference time',
          Number.isFinite(diagnostics?.latency_ms) ? `${diagnostics.latency_ms} ms` : null,
        ],
        ['Model version', modelVersion],
        ['Decision config version', result?.config_version ?? diagnostics?.config_version],
      ]);
      const metrics = Object.entries(quality?.metrics ?? {})
        .filter(([key, value]) => Object.hasOwn(metricLabels, key) && Number.isFinite(value))
        .map(([key, value]) => [metricLabels[key], value]);
      renderFacts(element('metrics'), metrics.length ? metrics : [['Measurements', 'Unavailable']]);
      if (body.image?.url) {
        image.src = body.image.url;
        image.hidden = false;
      }
      panel.hidden = false;
      status.textContent = 'Scan loaded.';
      const url = new URL(location.href);
      url.searchParams.set('scan_id', scanId);
      history.replaceState(null, '', url);
      await save({ lastViewedId: scanId });
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void load(form.elements.scan_id.value.trim());
  });
  const linkedId =
    new URLSearchParams(location.search).get('scan_id') ?? state.lastViewedId ?? state.scanId;
  if (linkedId) {
    form.elements.scan_id.value = linkedId;
    void load(linkedId);
  }
}

if (element('scan-form')) initializeUpload(element('scan-form'));
if (element('load-form')) initializeLookup(element('load-form'));
