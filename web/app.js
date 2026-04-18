import * as faceapi from 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js';
import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/vision_bundle.mjs';

const FACE_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
const MP_WASM     = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const POSE_MODEL  = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised'];
const EMOJI = { neutral: '😐', happy: '😀', sad: '😢', angry: '😠', surprised: '😮' };

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const emotionEl = document.getElementById('emotion');
const connectBtn = document.getElementById('connect');
const startBtn = document.getElementById('start');
const barsEl = document.getElementById('bars');

const bars = {};
for (const e of EMOTIONS) {
  const row = document.createElement('div');
  row.className = 'bar';
  row.dataset.emotion = e;
  row.innerHTML = `<span>${e}</span><div class="track"><div class="fill"></div></div>`;
  barsEl.appendChild(row);
  bars[e] = row;
}
const armsRow = document.createElement('div');
armsRow.id = 'armsRow';
armsRow.style.marginTop = '10px';
armsRow.style.fontSize = '16px';
armsRow.textContent = 'arms: —';
barsEl.appendChild(armsRow);

let port = null, writer = null;
let lastSent = null, lastSendAt = 0;
let poseLandmarker = null;
let mediaStream = null;
let running = false;
let modelsLoaded = false;

const setStatus = (m) => { statusEl.textContent = m; };

async function connectSerial() {
  if (!('serial' in navigator)) {
    setStatus('Web Serial not supported. Use Chrome/Edge on localhost.');
    return;
  }
  try {
    port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x2341 }] });
    await port.open({ baudRate: 115200 });
    const enc = new TextEncoderStream();
    enc.readable.pipeTo(port.writable);
    writer = enc.writable.getWriter();
    setStatus('serial connected');
    startBtn.disabled = false;
  } catch (err) {
    setStatus('serial error: ' + err.message);
  }
}

async function sendState(emotion, arms) {
  if (!writer) return;
  const payload = `${emotion},${arms}`;
  const now = performance.now();
  if (payload === lastSent && now - lastSendAt < 1000) return;
  lastSent = payload;
  lastSendAt = now;
  try { await writer.write(payload + '\n'); }
  catch (err) { setStatus('write error: ' + err.message); }
}

async function loadModels() {
  setStatus('loading face models…');
  await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS);
  await faceapi.nets.faceExpressionNet.loadFromUri(FACE_MODELS);
  setStatus('loading pose model…');
  const vision = await FilesetResolver.forVisionTasks(MP_WASM);
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  setStatus('models loaded');
}

async function startCamera() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = mediaStream;
  await new Promise(r => (video.onloadedmetadata = r));
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  running = true;
  setStatus('camera running');
  detectLoop();
}

function stopCamera() {
  running = false;
  if (mediaStream) {
    for (const t of mediaStream.getTracks()) t.stop();
    mediaStream = null;
  }
  video.srcObject = null;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  emotionEl.textContent = '—';
  armsRow.textContent = 'arms: —';
  for (const e of EMOTIONS) {
    bars[e].querySelector('.fill').style.width = '0%';
    bars[e].classList.remove('active');
  }
  setStatus('camera off');
}

function mapExpressions(expr) {
  const out = {
    neutral: expr.neutral,
    happy: expr.happy,
    sad: expr.sad,
    angry: expr.angry + expr.disgusted,
    surprised: expr.surprised + expr.fearful,
  };
  let best = 'neutral', bestV = -1;
  for (const k of EMOTIONS) if (out[k] > bestV) { bestV = out[k]; best = k; }
  return { scores: out, best, confidence: bestV };
}

// MediaPipe Pose indices: 11 L-shoulder, 12 R-shoulder, 15 L-wrist, 16 R-wrist.
// "left" is the subject's own left, i.e. camera-right when user faces the camera.
function detectArmsCrossed(landmarks) {
  if (!landmarks) return { crossed: false, confidence: 0 };
  const Ls = landmarks[11], Rs = landmarks[12], Lw = landmarks[15], Rw = landmarks[16];
  const minVis = Math.min(Ls?.visibility ?? 0, Rs?.visibility ?? 0, Lw?.visibility ?? 0, Rw?.visibility ?? 0);
  if (minVis < 0.5) return { crossed: false, confidence: 0 };
  const midX = (Ls.x + Rs.x) / 2;
  const shoulderWidth = Math.abs(Ls.x - Rs.x);
  // Wrists must cross the midline toward the opposite shoulder.
  const leftWristCrossed = Lw.x < midX;          // subject's left wrist is on the right half of frame; crossed means it's now on the left half
  const rightWristCrossed = Rw.x > midX;
  // Also require wrists to be close together horizontally (torso-width, not flung out)
  const wristGap = Math.abs(Lw.x - Rw.x);
  const crossed = leftWristCrossed && rightWristCrossed && wristGap < shoulderWidth * 1.2;
  return { crossed, confidence: minVis };
}

function drawPose(ctx, landmarks) {
  if (!landmarks) return;
  const edges = [[11,13],[13,15],[12,14],[14,16],[11,12]];
  ctx.strokeStyle = '#ffca28';
  ctx.lineWidth = 2;
  for (const [a, b] of edges) {
    const A = landmarks[a], B = landmarks[b];
    if (!A || !B) continue;
    ctx.beginPath();
    ctx.moveTo(A.x * overlay.width, A.y * overlay.height);
    ctx.lineTo(B.x * overlay.width, B.y * overlay.height);
    ctx.stroke();
  }
}

const faceOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

async function detectLoop() {
  const ctx = overlay.getContext('2d');
  let stableEmotion = 'neutral', stableArms = 'open';
  let pendingEmotion = 'neutral', pendingArms = 'open';
  let pendingSince = 0;

  while (running) {
    const ts = performance.now();
    const [faceResult, poseResult] = await Promise.all([
      faceapi.detectSingleFace(video, faceOpts).withFaceExpressions(),
      Promise.resolve(poseLandmarker?.detectForVideo(video, ts)),
    ]);

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    let emotion = stableEmotion, emoConf = 0;
    if (faceResult) {
      const { box } = faceResult.detection;
      ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      const m = mapExpressions(faceResult.expressions);
      emotion = m.best; emoConf = m.confidence;
      for (const e of EMOTIONS) {
        bars[e].querySelector('.fill').style.width = (Math.max(0, Math.min(1, m.scores[e])) * 100).toFixed(0) + '%';
        bars[e].classList.toggle('active', e === m.best);
      }
    }

    let armsState = stableArms, armsConf = 0;
    const lm = poseResult?.landmarks?.[0];
    if (lm) {
      drawPose(ctx, lm);
      const r = detectArmsCrossed(lm);
      armsState = r.crossed ? 'crossed' : 'open';
      armsConf = r.confidence;
    }

    emotionEl.textContent = faceResult ? `${EMOJI[emotion]} ${emotion}` : '— no face —';
    armsRow.textContent = `arms: ${armsState}${lm ? '' : ' (no pose)'}`;

    // Debounce: both must hold steady briefly before sending.
    if (emotion === pendingEmotion && armsState === pendingArms) {
      if (ts - pendingSince > 400 && emoConf > 0.5) {
        if (emotion !== stableEmotion || armsState !== stableArms) {
          stableEmotion = emotion; stableArms = armsState;
          sendState(stableEmotion, stableArms);
        }
      }
    } else {
      pendingEmotion = emotion; pendingArms = armsState; pendingSince = ts;
    }

    await new Promise(r => requestAnimationFrame(r));
  }
}

connectBtn.addEventListener('click', connectSerial);
startBtn.addEventListener('click', async () => {
  if (running) {
    stopCamera();
    startBtn.textContent = 'Start camera';
    return;
  }
  startBtn.disabled = true;
  try {
    if (!modelsLoaded) { await loadModels(); modelsLoaded = true; }
    await startCamera();
    startBtn.textContent = 'Stop camera';
  } finally {
    startBtn.disabled = false;
  }
});
