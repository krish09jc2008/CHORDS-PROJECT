// ---------- SETTINGS ----------
const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SR = 11025;     // we shrink the audio to 11025 samples/second so it runs fast
const SIZE = 4096;    // samples looked at in one "frame" (must be a power of 2)
const HOP = 2048;     // how far we move forward for the next frame
const GROUP = 3;      // 3 frames (about 0.55 s) are combined to decide one chord

// ---------- PAGE ELEMENTS ----------
const fileInput = document.getElementById("file");
const statusBox = document.getElementById("status");
const bar = document.getElementById("bar");
const player = document.getElementById("player");
const nowBox = document.getElementById("now");
const big = document.getElementById("big");
const list = document.getElementById("list");

let chords = [];   // final answer: [{time: 12.4, name: "Am"}, ...]

// ---------- STEP 1: user picks a file ----------
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  player.src = URL.createObjectURL(file);   // lets the user play the song
  player.style.display = "block";
  try {
    statusBox.textContent = "Reading the audio file...";
    const samples = await loadSamples(file);
    chords = await findChords(samples);
    showResults();
    statusBox.textContent = "Done! Press play to follow along.";
  } catch (err) {
    statusBox.textContent = "Could not read this file. Try another MP3 or WAV.";
    console.error(err);
  }
  bar.style.display = "none";
});

// ---------- STEP 2: turn the file into a list of numbers ----------
async function loadSamples(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ctx.decodeAudioData(await file.arrayBuffer());
  // OfflineAudioContext with 1 channel = mixes stereo to mono + lowers sample rate
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const done = await off.startRendering();
  return done.getChannelData(0);
}

// ---------- STEP 3: FFT (turns sound into "how loud is each pitch") ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {           // reorder the numbers
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {        // combine step by step
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr;        im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
}

// ---------- STEP 4: chord templates ----------
// A major chord = root + 4 notes up + 7 notes up. Minor = root + 3 + 7.
const templates = [];
for (let root = 0; root < 12; root++) {
  const major = new Array(12).fill(0);
  major[root] = major[(root + 4) % 12] = major[(root + 7) % 12] = 1;
  templates.push({ name: NOTES[root], t: major });
  const minor = new Array(12).fill(0);
  minor[root] = minor[(root + 3) % 12] = minor[(root + 7) % 12] = 1;
  templates.push({ name: NOTES[root] + "m", t: minor });
}

// Score all 24 chords for one 12-note "fingerprint" (1 = perfect match)
function scoreChords(chroma) {
  const norm = vecLength(chroma);
  if (norm < 1e-6) return null;                   // silence
  return templates.map(c => {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += chroma[i] * c.t[i];
    return dot / (norm * Math.sqrt(3));
  });
}
function vecLength(v) { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function indexOfMax(list) {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (list[i] > list[best]) best = i;
  return best;
}

// ---------- STEP 5: go through the whole song ----------
const BASS_MAX = 300;       // notes below 300 Hz are "bass" and get extra weight
const BASS_WEIGHT = 0.5;    // the bass usually plays the root note of the chord

async function findChords(samples) {
  const win = new Float32Array(SIZE);             // Hann window smooths frame edges
  for (let i = 0; i < SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE);

  const loBin = Math.ceil(80 * SIZE / SR);        // ignore sounds below 80 Hz
  const hiBin = Math.floor(2000 * SIZE / SR);     // ...and above 2000 Hz
  const bassBin = Math.floor(BASS_MAX * SIZE / SR);
  const totalFrames = Math.floor((samples.length - SIZE) / HOP);
  const groups = [];                              // one 12-note fingerprint per group
  let sum = new Array(12).fill(0), bassSum = new Array(12).fill(0);

  bar.style.display = "block";
  for (let f = 0; f < totalFrames; f++) {
    const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) re[i] = samples[f * HOP + i] * win[i];
    fft(re, im);

    // add the strength of every pitch into 12 note "buckets" (C, C#, D ...)
    for (let k = loBin; k <= hiBin; k++) {
      const freq = k * SR / SIZE;
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      const note = ((midi % 12) + 12) % 12;
      const strength = Math.sqrt(Math.hypot(re[k], im[k]));
      sum[note] += strength;
      if (k <= bassBin) bassSum[note] += strength;   // also keep the bass separately
    }

    if ((f + 1) % GROUP === 0) {
      // fingerprint = all notes + extra weight for the bass notes
      const a = vecLength(sum) + 1e-9, b = vecLength(bassSum) + 1e-9;
      groups.push(sum.map((v, i) => v / a + BASS_WEIGHT * bassSum[i] / b));
      sum = new Array(12).fill(0);
      bassSum = new Array(12).fill(0);
    }
    if (f % 100 === 0) {                          // let the page update the progress bar
      bar.value = (f / totalFrames) * 100;
      await new Promise(r => setTimeout(r));
    }
  }
  return pickChords(groups);
}

// ---------- STEP 6: choose the chords smartly ----------
const VOCAB_SHARE = 0.05;   // a chord must win 5% of the song to join the "vocabulary"
const VOCAB_BONUS = 0.15;   // vocabulary chords get a 15% score boost
const VOTE_RANGE = 2;       // each moment asks 2 neighbours on each side to vote
const MIN_SECONDS = 1.5;    // a chord shorter than this is merged into its neighbour

function pickChords(groups) {
  const scores = groups.map(scoreChords);

  // Pass 1: which chords does this song use most? That is its "vocabulary".
  const wins = new Array(24).fill(0);
  scores.forEach(s => { if (s) wins[indexOfMax(s)]++; });
  const vocab = wins.map(w => w / groups.length >= VOCAB_SHARE);

  // Pass 2: pick again, but favour the vocabulary chords
  const labels = scores.map(s =>
    s ? indexOfMax(s.map((v, i) => v * (1 + (vocab[i] ? VOCAB_BONUS : 0)))) : -1);

  // Majority vote: a chord must win among its neighbours too (removes flicker)
  const voted = labels.map((_, i) => {
    const counts = new Array(24).fill(0);
    for (let j = Math.max(0, i - VOTE_RANGE); j <= Math.min(labels.length - 1, i + VOTE_RANGE); j++) {
      if (labels[j] >= 0) counts[labels[j]]++;
    }
    return counts.some(c => c > 0) ? indexOfMax(counts) : -1;
  }).filter(l => l >= 0);
  if (voted.length === 0) return [];

  // Join repeated chords into segments: [{chord, length}, ...]
  const joinSame = list => {
    const out = [];
    list.forEach(s => {
      if (out.length && out[out.length - 1].chord === s.chord) out[out.length - 1].length += s.length;
      else out.push({ chord: s.chord, length: s.length });
    });
    return out;
  };
  const secondsPerGroup = GROUP * HOP / SR;
  const minLength = Math.round(MIN_SECONDS / secondsPerGroup);
  let segs = joinSame(voted.map(l => ({ chord: l, length: 1 })));

  // Merge chords that are too short into the longer neighbour
  let again = true;
  while (again && segs.length > 1) {
    again = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].length < minLength) {
        const left = i > 0, right = i < segs.length - 1;
        const j = left && (!right || segs[i - 1].length >= segs[i + 1].length) ? i - 1 : i + 1;
        segs[j].length += segs[i].length;
        segs.splice(i, 1);
        segs = joinSame(segs);
        again = true;
        break;
      }
    }
  }

  // Turn segments into a timeline with start times
  let t = 0;
  return segs.map(s => {
    const item = { time: t * secondsPerGroup, name: templates[s.chord].name };
    t += s.length;
    return item;
  });
}

// ---------- STEP 7: suggest a capo ----------
// A capo clamps all strings at one fret, so you can play easy shapes in a hard key.
// How easy is each shape? 1 = easy open chord, 0.5 = barre chord (harder). Others = 0.
const EASY = { C: 1, D: 1, E: 1, G: 1, A: 1, Am: 1, Dm: 1, Em: 1, F: 0.5, Bm: 0.5 };
const FLATS = { "A#": "Bb", "D#": "Eb", "G#": "Ab" };        // guitarists write flats

function pretty(name) {                                      // "A#m" -> "Bbm"
  const minor = name.endsWith("m");
  const root = minor ? name.slice(0, -1) : name;
  return (FLATS[root] || root) + (minor ? "m" : "");
}

// The shape you play with a capo: move the chord DOWN by the capo fret number
function shapeWithCapo(name, fret) {
  const minor = name.endsWith("m");
  const root = NOTES.indexOf(minor ? name.slice(0, -1) : name);
  return NOTES[(root - fret + 12) % 12] + (minor ? "m" : "");
}

// Try capo 0 to 7 and pick the one that makes the most playing time easy
function suggestCapo(durations) {
  const total = Object.values(durations).reduce((s, v) => s + v, 0);
  let best = { fret: 0, score: -Infinity };
  for (let fret = 0; fret <= 7; fret++) {
    let easyTime = 0;
    for (const name in durations) {
      easyTime += (EASY[shapeWithCapo(name, fret)] || 0) * durations[name];
    }
    const score = easyTime - 0.05 * total * fret;   // small penalty: lower frets are better
    if (score > best.score) best = { fret: fret, score: score };
  }
  return best.fret;
}

function ordinal(n) { return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"); }

function showCapo(durations, used) {
  const fret = suggestCapo(durations);
  const box = document.getElementById("capo");
  if (fret === 0) {
    box.innerHTML = "Capo: <b>not needed</b>. Play the chords as shown.";
  } else {
    const shapes = used.map(n => pretty(shapeWithCapo(n, fret))).join(", ");
    box.innerHTML = "Suggested capo: <b>" + ordinal(fret) + " fret</b>. Play these shapes: <b>" + shapes + "</b>";
  }
}

// ---------- STEP 8: show the answer ----------
function showResults() {
  list.innerHTML = "";
  chords.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.innerHTML = pretty(c.name) + "<small>" + formatTime(c.time) + "</small>";
    b.onclick = () => { player.currentTime = c.time; player.play(); };
    list.appendChild(b);
  });

  // count how long each chord is played, show the top 4
  const total = {};
  chords.forEach((c, i) => {
    const end = i + 1 < chords.length ? chords[i + 1].time : player.duration || c.time;
    total[c.name] = (total[c.name] || 0) + (end - c.time);
  });
  // "chords used" = every chord that plays for at least 5% of the song
  const all = Object.values(total).reduce((s, v) => s + v, 0);
  const used = Object.entries(total).filter(e => e[1] / all >= 0.05)
    .sort((a, b) => b[1] - a[1]).map(e => e[0]);
  document.getElementById("top").textContent = used.map(pretty).join("   ");
  showCapo(total, used);

  nowBox.style.display = "flex";
  document.getElementById("topTitle").style.display = "block";
  document.getElementById("listTitle").style.display = "block";
}

function formatTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

// ---------- STEP 9: highlight the chord that is playing right now ----------
player.addEventListener("timeupdate", () => {
  let current = -1;
  for (let i = 0; i < chords.length; i++) {
    if (chords[i].time <= player.currentTime) current = i;
  }
  big.textContent = current >= 0 ? pretty(chords[current].name) : "-";
  [...list.children].forEach((chip, i) => chip.classList.toggle("on", i === current));
});
