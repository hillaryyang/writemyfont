/* =====================
   Minimal Hanzi practice
   Single-file app for GitHub Pages
   — Features —
   • Apple Pencil / touch / mouse drawing
   • Hint overlay (hold H or toggle)
   • "Check" compares your ink to a bold glyph mask
   • Next/Prev through a small built-in deck (editable)
   • Works completely offline on GH Pages (no build tools)
===================== */

// --- Character deck (edit/add as you like) ---
let currentDeckName = "HSK 1";
let DECK = []; // Start with empty array

// DOM elements (declared after HTML loads)
const deckSelector = document.getElementById('deckSelector');
const bigChar = document.getElementById('bigChar');
const pinyin = document.getElementById('pinyin');
const meaning = document.getElementById('meaning');
const btnStroke = document.getElementById('btnStroke');
const btnHint = document.getElementById('btnHint');
const btnTheme = document.getElementById('btnTheme');
const btnUndo = document.getElementById('btnUndo');
const btnClear = document.getElementById('btnClear');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnShowAll = document.getElementById('btnShowAll');
const charModal = document.getElementById('charModal');
const modalClose = document.getElementById('modalClose');
const charGrid = document.getElementById('charGrid');
const modalTitle = document.getElementById('modalTitle');

const btnShuffle = document.getElementById('btnShuffle');
let isShuffled = false;

// Canvas setup
const board = document.getElementById('board');
const bgLayer = document.getElementById('bgLayer'); // grid + (optional) outline
const drawLayer = document.getElementById('drawLayer'); // user ink only
let bgCtx, drawCtx;
let dpr = Math.max(1, window.devicePixelRatio || 1);

// Offscreen mask for scoring
let maskCanvas = document.createElement('canvas');
let maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

let current = 0; // index in DECK
let showHint = false; // toggle
let drawing = false; // drawing state
let last = null; // last point
let penWidth = 10; // base width (scaled by pressure)
let undoStack = [];
// Drawing queue + RAF batching for smoother ink on high-frequency/stylus input
let pointQueue = [];
let drawPending = false;
let lastPoint = null; // structured point with x,y,pressure,time
let lastMid = null;   // midpoint used for quadratic smoothing

// ---- Brush plumbing helpers ----
const BRUSH = {
  spacing: 1.6,        // px between stamps (before multiplying by dpr)
  minSize: 2.0,        // base radius at dpr=1
  maxSize: 14.0,
  tiltEllipticity: 0.55,
  opacity: 1.0,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp  = (a, b, t) => a + (b - a) * t;

function normalizePressure(ev, lastPt) {
  let p = (typeof ev.pressure === 'number' && ev.pressure > 0)
            ? ev.pressure
            : (ev.force || 0);
  if (!p || p <= 0.05) {
    if (lastPt) {
      const dt = Math.max(1, ev.timeStamp - lastPt.time);
      const dx = ev.clientX - lastPt.cx, dy = ev.clientY - lastPt.cy;
      const v = Math.hypot(dx, dy) / dt;                // px/ms
      p = clamp(1 - Math.min(v / 2, 0.95), 0.08, 0.95); // slower => thicker
    } else {
      p = 0.6;
    }
  }
  return p;
}

function collectPoints(fromEvents) {
  for (const e of fromEvents) {
    const pt = toCanvasPoint(e, drawLayer);
    const pressure = normalizePressure(e, lastPoint);
    const altitude = typeof e.altitudeAngle === 'number' ? e.altitudeAngle : null;
    const azimuth  = typeof e.azimuthAngle  === 'number' ? e.azimuthAngle  : null;
    pointQueue.push({
      x: pt.x, y: pt.y, pressure, time: Date.now(),
      altitude, azimuth,
      cx: e.clientX, cy: e.clientY, // keep client coords for velocity sim
    });
    lastPoint = { ...pointQueue[pointQueue.length - 1] };
  }
}

// Event listener for HSK data loaded
window.addEventListener('hskDataLoaded', (event) => {
    const { level, count, error } = event.detail;
    console.log(`HSK ${level} loaded: ${count} characters${error ? ' (with errors)' : ''}`);

    // If this is the currently selected level, update the deck
    if (currentDeckName === `HSK ${level}`) {
        DECK = CHARACTER_DECKS[currentDeckName] || [];
        console.log(`Updated DECK for ${currentDeckName}, length:`, DECK.length);

        if (DECK.length > 0) {
            current = 0;
            setEntry(current);
        }
    }

    // Update the deck selector to show character counts
    const option = deckSelector.querySelector(`option[value="HSK ${level}"]`);
    if (option && count > 0) {
        option.textContent = `HSK ${level} (${count} chars)`;
    }
});

// Add deck change handler
deckSelector.addEventListener('change', async (e) => {
    const selectedDeck = e.target.value;
    const level = selectedDeck.split(' ')[1]; // Extract number from "HSK 1"

    // Show loading state
    bigChar.textContent = "⏳";
    pinyin.textContent = "Loading...";
    meaning.textContent = "Loading HSK " + level + " vocabulary...";

    try {
        // Load the level data if not already loaded
        await window.loadHSKLevel(parseInt(level));

        // Update current deck
        currentDeckName = selectedDeck;
        processDeck();
        current = 0;

        if (DECK.length > 0) {
            setEntry(0);
        } else {
            console.error('No characters found for', currentDeckName);
            meaning.textContent = "No single characters found for " + selectedDeck;
        }
    } catch (error) {
        console.error('Failed to load HSK level:', error);
        bigChar.textContent = "❌";
        pinyin.textContent = "Error";
        meaning.textContent = "Failed to load HSK " + level + " vocabulary";
    }
});

function resizeCanvases() {
    const rect = board.getBoundingClientRect();
    const W = Math.floor(rect.width * dpr);
    const H = Math.floor(rect.height * dpr);

    for (const c of [bgLayer, drawLayer, maskCanvas]) {
        c.width = W;
        c.height = H;
        c.style.width = rect.width + 'px';
        c.style.height = rect.height + 'px';
    }
    bgCtx = bgLayer.getContext('2d');
    drawCtx = drawLayer.getContext('2d');
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';

    redrawBackground();
    if (DECK && DECK[current]) {
        drawMaskForChar(DECK[current]);
    }
}

function redrawBackground() {
    const ctx = bgCtx;
    const W = bgLayer.width,
        H = bgLayer.height;
    ctx.clearRect(0, 0, W, H);
    if (showHint && DECK && DECK[current] && DECK[current].char) {
        // faint character outline for guidance
        ctx.save();
        ctx.globalAlpha = 0.10;
        drawGlyph(ctx, DECK[current].char, W, H, true);
        ctx.restore();
    }
}

function drawMaskForChar(entry) {
    if (!entry || !entry.char) {
        console.log('Cannot draw mask: invalid entry', entry);
        return;
    }

    const W = maskCanvas.width,
        H = maskCanvas.height;
    maskCtx.clearRect(0, 0, W, H);
    drawGlyph(maskCtx, entry.char, W, H, false);
}

// Draws a big centered glyph into the given context.
// If outline==true, we stroke instead of fill (for nicer hint).
function drawGlyph(ctx, char, W, H, outline) {
    if (!char) return;

    ctx.save();
    const pad = Math.min(W, H) * 0.12; // inner padding
    const size = Math.min(W, H) - pad * 2; // font size in pixels
    ctx.translate(W / 2, H / 2);
    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue('--muted').trim();
    ctx.fillStyle = textColor;
    ctx.strokeStyle = textColor;
    // Use a heavy weight for a thicker mask band to be forgiving
    ctx.font = `900 ${size}px \"Noto Sans SC\", \"PingFang SC\", \"Hiragino Sans GB\", STHeiti, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
        ctx.lineWidth = Math.max(4, size * 0.02);
        ctx.strokeText(char, 0, 0);
    } else {
        ctx.fillText(char, 0, 0);
    }
    ctx.restore();
}

function setEntry(i) {
    if (!DECK || DECK.length === 0) {
        console.log('No deck data available yet');
        bigChar.textContent = "⏳";
        pinyin.textContent = "Loading...";
        meaning.textContent = "Loading vocabulary...";
        return;
    }

    current = (i + DECK.length) % DECK.length;
    const e = DECK[current];

    // Check if entry has required properties
    if (!e || !e.char) {
        console.error('Invalid entry:', e);
        return;
    }

    console.log('Setting entry:', e); // Debug log

    bigChar.textContent = e.char;
    pinyin.textContent = e.pinyin || '';
    meaning.textContent = e.meaning || '';

    clearInk();
    redrawBackground();
    drawMaskForChar(e);
    undoStack = [];
    updateUndoButton();
    saveProgress(); //  ◄◄◄ ADD THIS LINE
}

function clearInk() {
    if (drawCtx) {
        drawCtx.clearRect(0, 0, drawLayer.width, drawLayer.height);
    }
    undoStack = [];
    updateUndoButton();
}

function saveCanvasState() {
    if (drawCtx) {
        const imageData = drawCtx.getImageData(0, 0, drawLayer.width, drawLayer.height);
        undoStack.push(imageData);
        // Keep only last 20 states to prevent memory issues
        if (undoStack.length > 20) {
            undoStack.shift();
        }
        updateUndoButton();
    }
}

function undo() {
    if (undoStack.length > 0 && drawCtx) {
        const imageData = undoStack.pop();
        drawCtx.putImageData(imageData, 0, 0);
        updateUndoButton();
    }
}

function updateUndoButton() {
    btnUndo.disabled = undoStack.length === 0;
    btnUndo.style.opacity = undoStack.length === 0 ? '0.5' : '1';
}

function saveProgress() {
    if (!currentDeckName || DECK.length === 0) return; // Don't save if nothing is loaded

    const progress = {
        deckName: currentDeckName,
        charIndex: current
    };

    localStorage.setItem('hanziPracticeProgress', JSON.stringify(progress));
    console.log('Progress saved:', progress);
}

// Drawing handlers (pointer events)
function toCanvasPoint(ev, target) {
    const rect = target.getBoundingClientRect();
    // Support both PointerEvent-like objects and touch-like objects
    const clientX = ev.clientX != null ? ev.clientX : (ev.pageX || 0);
    const clientY = ev.clientY != null ? ev.clientY : (ev.pageY || 0);
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;
    return { x, y };
}

function pointerDown(ev) {
  const pType = ev.pointerType || 'pen';
  if (pType === 'touch' && ev.isPrimary === false) return;
  ev.preventDefault();

  saveCanvasState();
  drawing = true;
  try { drawLayer.setPointerCapture && drawLayer.setPointerCapture(ev.pointerId); } catch {}

  pointQueue = [];
  last = null;
  lastPoint = { cx: ev.clientX, cy: ev.clientY, time: ev.timeStamp };
  collectPoints([ev]);
  if (!drawPending) { drawPending = true; requestAnimationFrame(processPointQueue); }
}

function pointerMove(ev) {
  if (!drawing) return;
  ev.preventDefault();

  const coalesced = (typeof ev.getCoalescedEvents === 'function') ? ev.getCoalescedEvents() : null;
  collectPoints(coalesced && coalesced.length ? coalesced : [ev]);
  if (!drawPending) { drawPending = true; requestAnimationFrame(processPointQueue); }
}

function pointerUp(ev) {
  drawing = false;
  last = null;
  pointQueue = [];
  drawPending = false;
  try { drawLayer.releasePointerCapture && drawLayer.releasePointerCapture(ev.pointerId); } catch {}
}

// RAF-driven processor for queued points
function processPointQueue() {
  drawPending = false;
  if (!drawCtx || pointQueue.length === 0) return;

  // Ink color from theme
  const styles = getComputedStyle(document.documentElement);
  const inkColor = styles.getPropertyValue('--text').trim();
  drawCtx.fillStyle = inkColor;
  drawCtx.globalAlpha = BRUSH.opacity;

  const spacing = BRUSH.spacing * dpr;

  while (pointQueue.length) {
    const p = pointQueue.shift();

    if (!last) {
      last = { x: p.x, y: p.y };
      stamp(p.x, p.y, p.pressure, p.altitude, p.azimuth);
      continue;
    }

    const dx = p.x - last.x, dy = p.y - last.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) { continue; }

    const steps = Math.max(1, Math.floor(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = last.x + dx * t;
      const y = last.y + dy * t;
      const pr = p.pressure;
      stamp(x, y, pr, p.altitude, p.azimuth);
    }

    last = { x: p.x, y: p.y };
  }

  function stamp(x, y, pressure, altitude, azimuth) {
    const min = BRUSH.minSize * dpr;
    const max = BRUSH.maxSize * dpr;
    const r = lerp(min, max, clamp(pressure, 0.0, 1.0));

    if (typeof altitude === 'number' && typeof azimuth === 'number') {
      // More tilt => more elongation
      const tilt = clamp(1 - (altitude / (Math.PI / 2)), 0, 1);
      const a = r * (1 + tilt * (1/BRUSH.tiltEllipticity - 1)); // major axis
      const b = r * BRUSH.tiltEllipticity;                       // minor axis

      drawCtx.save();
      drawCtx.translate(x, y);
      drawCtx.rotate(azimuth);
      drawCtx.beginPath();
      drawCtx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
      drawCtx.fill();
      drawCtx.restore();
    } else {
      drawCtx.beginPath();
      drawCtx.arc(x, y, r, 0, Math.PI * 2);
      drawCtx.fill();
    }
  }
}

function populateCharGrid() {
    if (!DECK || DECK.length === 0) return;

    charGrid.innerHTML = '';
    modalTitle.textContent = `${currentDeckName} Characters (${DECK.length})`;

    DECK.forEach((entry, index) => {
        const charItem = document.createElement('button');
        charItem.className = 'char-grid-item';
        charItem.textContent = entry.char;
        charItem.dataset.index = index;
        charGrid.appendChild(charItem);
    });
}

function openModal() {
    populateCharGrid();
    charModal.classList.remove('hidden');
}

function closeModal() {
    charModal.classList.add('hidden');
}

// Standard Fisher-Yates shuffle algorithm to randomize an array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// This function will set the DECK to be either ordered or shuffled
function processDeck() {
    const originalDeck = CHARACTER_DECKS[currentDeckName] || [];
    if (isShuffled) {
        DECK = [...originalDeck]; // Create a shuffled copy
        shuffleArray(DECK);
    } else {
        DECK = originalDeck; // Use the original ordered deck
    }
}

// This runs when the shuffle button is clicked
function toggleShuffle() {
    isShuffled = !isShuffled; // Flip the state
    btnShuffle.classList.toggle('active', isShuffled); // Update button style
    localStorage.setItem('hanziShuffleState', isShuffled); // Save preference

    processDeck(); // Re-process the deck (shuffle or un-shuffle)
    setEntry(0); // Go to the first character of the new order
}

btnShowAll.addEventListener('click', openModal);
btnShuffle.addEventListener('click', toggleShuffle);

modalClose.addEventListener('click', closeModal);
charModal.addEventListener('click', (e) => {
    if (e.target === charModal) {
        closeModal();
    }
});

charGrid.addEventListener('click', (e) => {
    const target = e.target.closest('.char-grid-item');
    if (target && target.dataset.index) {
        const charIndex = parseInt(target.dataset.index, 10);
        setEntry(charIndex);
        closeModal();
    }
});

// UI actions
btnHint.addEventListener('click', () => { showHint = !showHint;
    redrawBackground(); });
btnClear.addEventListener('click', clearInk);
btnUndo.addEventListener('click', undo);
btnPrev.addEventListener('click', () => setEntry(current - 1));
btnNext.addEventListener('click', () => setEntry(current + 1));
btnTheme.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? null : 'light';
    document.documentElement.setAttribute('data-theme', newTheme || 'dark');
    localStorage.setItem('theme', newTheme || 'dark');
});
btnStroke.addEventListener('click', () => {
    if (DECK && DECK[current] && DECK[current].char) {
        const c = DECK[current].char;
        const q = encodeURIComponent(`chinese/${c}`);
        window.open(`https://www.strokeorder.com/${q}`, '_blank');
    }
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') { showHint = true;
        redrawBackground(); }
    if (e.key === 'Backspace') { e.preventDefault();
        clearInk(); }
    if (e.key === 'ArrowLeft') { setEntry(current - 1); }
    if (e.key === 'ArrowRight') { setEntry(current + 1); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault();
        undo(); }
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'h' || e.key === 'H') { showHint = false;
        redrawBackground(); }
});

// Pointer events
['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
  drawLayer.addEventListener(type, (ev) => {
    if (type === 'pointerdown') pointerDown(ev);
    else if (type === 'pointermove') pointerMove(ev);
    else pointerUp(ev);
  }, { passive:false });
});

// Extra high-frequency updates on Safari (Apple Pencil)
drawLayer.addEventListener('pointerrawupdate', (ev) => {
  if (!drawing) return;
  const coalesced = (typeof ev.getCoalescedEvents === 'function') ? ev.getCoalescedEvents() : null;
  collectPoints(coalesced && coalesced.length ? coalesced : [ev]);
  if (!drawPending) { drawPending = true; requestAnimationFrame(processPointQueue); }
}, { passive:false });


// Init
window.addEventListener('resize', resizeCanvases);
window.addEventListener('load', async () => {
    resizeCanvases();

    // Initialize theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateUndoButton();

    const savedShuffleState = localStorage.getItem('hanziShuffleState') === 'true';
    if (savedShuffleState) {
        isShuffled = true;
        btnShuffle.classList.add('active');
    }

    // LOAD PROGRESS LOGIC
    const savedProgressJSON = localStorage.getItem('hanziPracticeProgress');
    let progressLoaded = false;

    if (savedProgressJSON) {
        try {
            const savedProgress = JSON.parse(savedProgressJSON);
            console.log('Found saved progress:', savedProgress);

            if (savedProgress.deckName && typeof savedProgress.charIndex === 'number') {
                deckSelector.value = savedProgress.deckName;
                currentDeckName = savedProgress.deckName;
                const level = savedProgress.deckName.split(' ')[1];

                await window.loadHSKLevel(parseInt(level));
                processDeck(); // <-- ADD THIS LINE

                setEntry(savedProgress.charIndex);
                progressLoaded = true;
            }
        } catch (error) {
            console.error("Failed to load progress:", error);
        }
    }

    // If no progress was loaded, load the default HSK 1 deck
    if (!progressLoaded) {
        try {
            await window.loadHSKLevel(1);
            processDeck(); // <-- AND ADD THIS LINE
        } catch (error) {
            console.error("Failed to load initial HSK 1 deck:", error);
        }
    }
});