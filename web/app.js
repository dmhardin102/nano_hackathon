import { FaceLandmarker, FilesetResolver, DrawingUtils } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs';

const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised'];
const EMOJI = { neutral: '😐', happy: '😀', sad: '😢', angry: '😠', surprised: '😮' };

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const emotionEl = document.getElementById('emotion');
const barsEl = document.getElementById('bars');
const loaderEl = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');
const retryBtn = document.getElementById('retryBtn');
const npsScaleEl = document.getElementById('npsScale');
const npsArrowEl = document.getElementById('npsArrow');
const npsAvgEl = document.getElementById('npsAvg');

const ctx = overlay.getContext('2d');
let drawingUtils = null;

const NPS_FACES = ['😡','😠','😤','😟','😕','😐','😐','🙂','🙂','😀','😁'];
const NPS_CELLS = [];
for (let i = 0; i <= 10; i++) {
  const cell = document.createElement('div');
  cell.className = 'nps-cell';
  const face = document.createElement('div');
  face.className = 'nps-face';
  face.textContent = NPS_FACES[i];
  const num = document.createElement('div');
  num.className = 'nps-num';
  num.textContent = i;
  cell.appendChild(face);
  cell.appendChild(num);
  npsScaleEl.appendChild(cell);
  NPS_CELLS.push(cell);
}

const EMOTION_NPS = { happy: 9.5, surprised: 8, neutral: 7, sad: 3, angry: 1 };
const NPS_WINDOW = 90;
const npsHistory = [];
let npsAvg = null;

const bars = {};
for (const e of EMOTIONS) {
  const row = document.createElement('div');
  row.className = 'bar';
  row.dataset.emotion = e;
  const label = document.createElement('span');
  label.textContent = e;
  const track = document.createElement('div');
  track.className = 'track';
  const fill = document.createElement('div');
  fill.className = 'fill';
  track.appendChild(fill);
  row.appendChild(label);
  row.appendChild(track);
  barsEl.appendChild(row);
  bars[e] = row;
}

let faceLandmarker = null;
let mediaStream = null;
let running = false;

const setStatus = (m) => { statusEl.textContent = m; };

const bs_val = (bs, key) => bs[key] || 0;

function scoreEmotions(bs) {
  const happy = (bs_val(bs, 'mouthSmileLeft') + bs_val(bs, 'mouthSmileRight')) / 2
    + (bs_val(bs, 'cheekSquintLeft') + bs_val(bs, 'cheekSquintRight')) * 0.15;
  const sad = (bs_val(bs, 'mouthFrownLeft') + bs_val(bs, 'mouthFrownRight')) / 2
    + bs_val(bs, 'browInnerUp') * 0.3;
  const angry = (bs_val(bs, 'browDownLeft') + bs_val(bs, 'browDownRight')) / 2
    + (bs_val(bs, 'noseSneerLeft') + bs_val(bs, 'noseSneerRight')) * 0.15;
  const angryGated = (bs_val(bs, 'browDownLeft') > 0.4 && bs_val(bs, 'browDownRight') > 0.4) ? angry : angry * 0.25;
  const surprised = (bs_val(bs, 'eyeWideLeft') + bs_val(bs, 'eyeWideRight')) / 2
    + bs_val(bs, 'jawOpen') * 0.3
    + (bs_val(bs, 'browOuterUpLeft') + bs_val(bs, 'browOuterUpRight')) * 0.15;

  const scores = { happy, sad, angry: angryGated, surprised };
  const max = Math.max(...Object.values(scores));
  const threshold = 0.25;

  let best = 'neutral';
  let bestV = 0;
  if (max > threshold) {
    for (const k of Object.keys(scores)) {
      if (scores[k] > bestV) { bestV = scores[k]; best = k; }
    }
  }
  scores.neutral = max <= threshold ? 1 : Math.max(0, 1 - max);

  return { scores, best };
}

function updateNPS(scores) {
  let npsRaw = 0;
  let total = 0;
  for (const [emo, weight] of Object.entries(scores)) {
    if (EMOTION_NPS[emo] !== undefined) {
      npsRaw += EMOTION_NPS[emo] * weight;
      total += weight;
    }
  }
  if (total > 0) npsRaw /= total;

  npsHistory.push(npsRaw);
  if (npsHistory.length > NPS_WINDOW) npsHistory.shift();

  npsAvg = npsHistory.reduce((a, b) => a + b, 0) / npsHistory.length;
  const rounded = Math.round(npsAvg);
  const clamped = Math.max(0, Math.min(10, rounded));

  for (let i = 0; i <= 10; i++) {
    NPS_CELLS[i].classList.toggle('active', i === clamped);
  }

  const pct = (npsAvg / 10) * 100;
  npsArrowEl.style.left = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';

  let label, cls;
  if (npsAvg >= 9) { label = 'Promoter'; cls = 'promoter'; }
  else if (npsAvg >= 7) { label = 'Passive'; cls = 'passive'; }
  else { label = 'Detractor'; cls = 'detractor'; }

  npsAvgEl.textContent = '';
  const prefix = document.createTextNode('NPS: ');
  const strong = document.createElement('strong');
  strong.textContent = npsAvg.toFixed(1);
  const span = document.createElement('span');
  span.className = `nps-label ${cls}`;
  span.textContent = label;
  npsAvgEl.append(prefix, strong, ' ', span);
}

function showLoader(msg) { loaderText.textContent = msg; loaderEl.classList.add('visible'); }
function hideLoader() { loaderEl.classList.remove('visible'); }

function showCameraError(msg) {
  hideLoader();
  setStatus(msg);
  retryBtn.style.display = 'inline-block';
  emotionEl.textContent = '🚫';
}

async function loadModels() {
  showLoader('Loading face model…');
  setStatus('loading face model…');
  const vision = await FilesetResolver.forVisionTasks(MP_WASM);
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
  setStatus('model loaded');
  showLoader('Starting camera…');
}

async function startCamera() {
  retryBtn.style.display = 'none';
  showLoader('Starting camera…');

  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'camera' });
      if (perm.state === 'denied') {
        showCameraError('Camera permission is blocked. Click the camera or lock icon in your address bar, allow camera access, then try again.');
        return;
      }
    } catch (_) { /* permissions API not supported for camera, fall through */ }
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showCameraError('Camera permission denied. Click the camera or lock icon in your address bar to allow access, then try again.');
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      showCameraError('No camera found. Please connect a camera and try again.');
    } else {
      showCameraError(`Camera error: ${err.message}`);
    }
    return;
  }

  video.srcObject = mediaStream;
  await new Promise(r => (video.onloadedmetadata = r));
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  drawingUtils = new DrawingUtils(ctx);
  running = true;
  hideLoader();
  setStatus('');
  detectLoop();
}

function stopCamera() {
  running = false;
  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
    mediaStream = null;
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  emotionEl.textContent = '—';
  for (const e of EMOTIONS) {
    bars[e].querySelector('.fill').style.width = '0%';
    bars[e].classList.remove('active');
  }
  setStatus('camera off');
}

let lastVideoTime = -1;

function detectLoop() {
  if (!running) return;

  const nowMs = Date.now();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = faceLandmarker.detectForVideo(video, nowMs);

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      drawingUtils.drawConnectors(
        result.faceLandmarks[0],
        FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        { color: '#4caf5040', lineWidth: 0.5 }
      );
      drawingUtils.drawConnectors(
        result.faceLandmarks[0],
        FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
        { color: '#4caf50', lineWidth: 1.5 }
      );
    }

    if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
      const bs = {};
      for (const cat of result.faceBlendshapes[0].categories) {
        bs[cat.categoryName] = cat.score;
      }
      const m = scoreEmotions(bs);
      emotionEl.textContent = `${EMOJI[m.best]} ${m.best}`;
      for (const e of EMOTIONS) {
        const val = Math.max(0, Math.min(1, m.scores[e] || 0));
        bars[e].querySelector('.fill').style.width = (val * 100).toFixed(0) + '%';
        bars[e].classList.toggle('active', e === m.best);
      }
      updateNPS(m.scores);
    } else {
      emotionEl.textContent = '👀';
      for (const e of EMOTIONS) {
        bars[e].querySelector('.fill').style.width = '0%';
        bars[e].classList.remove('active');
      }
    }
  }

  requestAnimationFrame(detectLoop);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    stopCamera();
  }
});

retryBtn.addEventListener('click', () => {
  startCamera();
});

(async () => {
  try {
    await loadModels();
    await startCamera();
  } catch (err) {
    hideLoader();
    setStatus(`Failed to initialize: ${err.message}`);
    emotionEl.textContent = '❌';
  }
})();
