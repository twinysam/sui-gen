/**
 * Sui-Gen Main Thread Logic
 * Handles UI interactions and Worker communication.
 */

import { toJSON, toCSV, toYAML, toSQL, toMarkdown } from './formatters.js';

// DOM Elements
const btnGenerate = document.getElementById('btnGenerate');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const progressBarContainer = document.getElementById('progressBarContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const codePreview = document.getElementById('codePreview');
const totalSize = document.getElementById('totalSize');
const previewLimit = document.getElementById('previewLimit');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');
const formatSelect = document.getElementById('formatSelect');
const startYearInput = document.getElementById('startYear');
const endYearInput = document.getElementById('endYear');
const fieldWarningBanner = document.getElementById('fieldWarningBanner');
const fieldWarningText = document.getElementById('fieldWarningText');

// Reliability Tiers (Hard Limits and Warnings)
const FIELD_RANGES = {
    newMoonUtc: { warnBefore: null, warnAfter: null, hardBefore: 619, hardAfter: 17190, id: 'fieldNewMoonUtc', noteId: 'noteNewMoonUtc' },
    liChun:     { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17190, id: 'fieldLiChun', noteId: 'noteLiChun' },
    cnyDate:    { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17190, id: 'fieldCnyDate', noteId: 'noteCnyDate' },
    leapMonth:  { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17190, id: 'fieldLeapMonth', noteId: 'noteLeapMonth' },
    yearLength: { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17190, id: 'fieldYearLength', noteId: 'noteYearLength' },
    zodiac:     { warnBefore: null, warnAfter: null,  hardBefore: null, hardAfter: null, id: 'fieldZodiac', noteId: 'noteZodiac' },
    ganzhi:     { warnBefore: null, warnAfter: null,  hardBefore: null, hardAfter: null, id: 'fieldGanzhi', noteId: 'noteGanzhi' },
    element:    { warnBefore: null, warnAfter: null,  hardBefore: null, hardAfter: null, id: 'fieldElement', noteId: 'noteElement' },
};
// Format Configuration
const FORMAT_CONFIG = {
    json: { ext: '.json', mime: 'application/json', lang: 'language-json', fn: toJSON },
    csv:  { ext: '.csv',  mime: 'text/csv',         lang: '',              fn: toCSV },
    yaml: { ext: '.yaml', mime: 'text/yaml',        lang: 'language-yaml', fn: toYAML },
    sql:  { ext: '.sql',  mime: 'text/sql',         lang: 'language-sql',  fn: toSQL },
    md:   { ext: '.md',   mime: 'text/markdown',    lang: 'language-markdown', fn: toMarkdown }
};

// Worker Reference
let worker = null;
let generatedData = null;
let cachedJplData = null; // Cache the pre-computed JPL data

// ===========================
// Theme Management
// ===========================
const THEME_KEY = 'sui-gen-theme';
const hljsLight = document.getElementById('hljs-light');
const hljsDark = document.getElementById('hljs-dark');
const htmlEl = document.documentElement;
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(mode) {
    let effective;
    if (mode === 'auto') {
        effective = systemDarkQuery.matches ? 'dark' : 'light';
    } else {
        effective = mode;
    }
    htmlEl.setAttribute('data-bs-theme', effective);
    // Swap Highlight.js stylesheets
    hljsLight.disabled = (effective === 'dark');
    hljsDark.disabled = (effective !== 'dark');
}

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'auto';
    // Check the matching radio button
    const radio = document.querySelector(`input[name="theme"][value="${saved}"]`);
    if (radio) radio.checked = true;
    applyTheme(saved);

    // Listen for toggle changes
    document.querySelectorAll('input[name="theme"]').forEach(input => {
        input.addEventListener('change', (e) => {
            const mode = e.target.value;
            localStorage.setItem(THEME_KEY, mode);
            applyTheme(mode);
        });
    });

    // Listen for system color scheme changes (for auto mode)
    systemDarkQuery.addEventListener('change', () => {
        const current = localStorage.getItem(THEME_KEY) || 'auto';
        if (current === 'auto') {
            applyTheme('auto');
        }
    });
}

// Initialize Worker
function initWorker() {
    if (window.Worker) {
        worker = new Worker('js/worker.js');
        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;
    } else {
        alert('Your browser does not support Web Workers. Sui-Gen requires Web Workers to function.');
        btnGenerate.disabled = true;
    }
}

// Handle Messages from Worker
function handleWorkerMessage(e) {
    const { type, data, usedFallback } = e.data;

    if (type === 'progress') {
        const { current, total, status } = data;
        if (current !== undefined && total !== undefined) {
            const percent = Math.round((current / total) * 100);
            progressBar.style.width = `${percent}%`;
            // Ensure container remains visible while processing
            progressBarContainer.style.display = 'flex';
        }
        if (status) {
            statusText.textContent = status;
        }
    } else if (type === 'complete') {
        progressBar.style.width = '100%';
        generatedData = data;
        finishGeneration(usedFallback);
    } else if (type === 'error') {
        handleWorkerError({ message: data });
    }
}

// Handle Worker Errors
function handleWorkerError(error) {
    console.error('Worker Error:', error);
    statusText.textContent = `Error: ${error.message}`;
    resetUI();
    alert('An error occurred during generation. Check console for details.');
}

// Pre-load JPL data
async function loadJplData() {
    if (cachedJplData) return cachedJplData;
    try {
        statusText.textContent = 'Loading ephemeris data...';
        const res = await fetch('sui-gen-jpl-source_619-17190.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        cachedJplData = await res.json();
        return cachedJplData;
    } catch (err) {
        console.warn('Could not pre-load JPL JSON:', err.message);
        return null;
    }
}

// Start Generation Process
async function startGeneration() {
    const startYear = parseInt(document.getElementById('startYear').value, 10);
    const endYear = parseInt(document.getElementById('endYear').value, 10);
    
    // Validation
    if (isNaN(startYear) || isNaN(endYear)) {
        alert('Please enter valid start and end years.');
        return;
    }
    if (startYear > endYear) {
        alert('Start Year cannot be greater than End Year.');
        return;
    }

    // Gather Fields
    const fields = {
        cnyDate: document.getElementById('fieldCnyDate').checked,
        zodiac: document.getElementById('fieldZodiac').checked,
        element: document.getElementById('fieldElement').checked,
        ganzhi: document.getElementById('fieldGanzhi').checked,
        liChun: document.getElementById('fieldLiChun').checked,
        yearLength: document.getElementById('fieldYearLength').checked,
        leapMonth: document.getElementById('fieldLeapMonth').checked,
        newMoonUtc: document.getElementById('fieldNewMoonUtc').checked
    };

    // UI Updates
    btnGenerate.disabled = true;
    spinner.classList.remove('d-none');
    btnText.textContent = 'Generating...';
    progressBarContainer.style.display = 'flex';
    progressBar.style.width = '0%';
    statusText.textContent = 'Loading ephemeris data...';
    codePreview.textContent = 'Generating...';
    btnCopy.disabled = true;
    btnDownload.disabled = true;

    // Load JPL data and pass to Worker
    const jplData = await loadJplData();
    const partialCoverage = document.getElementById('fieldPartialCoverage')?.checked || false;

    worker.postMessage({
        cmd: 'generate',
        payload: { startYear, endYear, fields, jplData, partialCoverage }
    });
}

// Update Preview and Download Buttons based on current data and format
function updateOutput() {
    if (!generatedData) return;

    const format = formatSelect.value;
    const config = FORMAT_CONFIG[format];
    const outputString = config.fn(generatedData);
    const blob = new Blob([outputString], { type: config.mime });
    const sizeKB = blob.size / 1024;
    
    // Update UI Stats
    if (sizeKB > 1000) {
        totalSize.textContent = `${(sizeKB / 1024).toFixed(2)} MB`;
    } else {
        totalSize.textContent = `${sizeKB.toFixed(2)} KB`;
    }

    // Preview Logic (First 1000 lines)
    const lines = outputString.split('\n');
    const previewContent = lines.slice(0, 1000).join('\n') + (lines.length > 1000 ? '\n... (truncated for preview)' : '');

    // Reset hljs state
    codePreview.textContent = previewContent;
    codePreview.removeAttribute('data-highlighted');
    codePreview.className = config.lang; 
    
    // Apply Highlight.js if language is supported and loaded
    if (config.lang && typeof hljs !== 'undefined') {
        hljs.highlightElement(codePreview);
    }

    // Update Buttons
    btnCopy.onclick = () => {
        navigator.clipboard.writeText(outputString).then(() => {
            const originalText = btnCopy.textContent;
            btnCopy.textContent = 'Copied!';
            setTimeout(() => btnCopy.textContent = originalText, 2000);
        });
    };

    btnDownload.innerText = `Download ${config.ext}`;
    btnDownload.onclick = () => {
        const start = generatedData[0].year;
        const end = generatedData[generatedData.length - 1].year;
        const filename = `sui-gen-${start}-${end}${config.ext}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
}

// Finish Generation
function finishGeneration(usedFallback) {
    updateOutput();
    
    if (usedFallback) {
        statusText.innerHTML = 'Generation Complete! <span class="text-success fw-bold">(JPL DE440/DE441)</span> <span class="text-warning fw-bold">+ Cycle data fallback for out-of-range years</span>';
    } else {
        statusText.innerHTML = 'Generation Complete! <span class="text-success fw-bold">(JPL DE440/DE441 Precision)</span>';
    }
    
    resetUI();
    
    // Enable Actions
    btnCopy.disabled = false;
    btnDownload.disabled = false;
}

// Handle Format Change
formatSelect.addEventListener('change', () => {
    if (generatedData) {
        updateOutput();
    }
});

// Reset UI State
function resetUI() {
    btnGenerate.disabled = false;
    spinner.classList.add('d-none');
    btnText.textContent = 'Generate Calendar';
    // Hide progress bar when idle/complete
    progressBarContainer.style.display = 'none';
}

function validateFieldAvailability() {
    const startYear = parseInt(startYearInput.value, 10);
    const endYear = parseInt(endYearInput.value, 10);
    if (isNaN(startYear) || isNaN(endYear)) return;

    const partialToggle = document.getElementById('partialCoverageToggle');
    const partialCheckbox = document.getElementById('fieldPartialCoverage');
    const allowPartial = partialCheckbox && partialCheckbox.checked;

    // Determine if any field has range issues
    let hasOutOfRange = false;

    for (const [fieldKey, range] of Object.entries(FIELD_RANGES)) {
        const checkbox = document.getElementById(range.id);
        const noteSpan = document.getElementById(range.noteId);
        if (!checkbox || !noteSpan) continue;

        let hardBlockedBefore = range.hardBefore !== null && startYear < range.hardBefore;
        let hardBlockedAfter = range.hardAfter !== null && endYear > range.hardAfter;

        if (hardBlockedBefore || hardBlockedAfter) {
            hasOutOfRange = true;

            if (allowPartial) {
                // Partial coverage mode: re-enable fields, show inline note
                checkbox.disabled = false;
                noteSpan.textContent = `(null outside ${range.hardBefore}–${range.hardAfter} CE)`;
            } else {
                // Default: disable fields out of range
                checkbox.disabled = true;
                checkbox.checked = false;
                noteSpan.textContent = hardBlockedBefore 
                    ? `(not available before ${range.hardBefore} CE)` 
                    : `(not available after ${range.hardAfter} CE)`;
            }
        } else {
            checkbox.disabled = false;
            noteSpan.textContent = "";
        }
    }

    // Show/hide the partial coverage toggle
    if (hasOutOfRange) {
        partialToggle.classList.remove('d-none');
    } else {
        partialToggle.classList.add('d-none');
        if (partialCheckbox) partialCheckbox.checked = false;
    }

    fieldWarningBanner.classList.add('d-none');
}

// Partial coverage toggle listener
const partialCoverageCheckbox = document.getElementById('fieldPartialCoverage');
if (partialCoverageCheckbox) {
    partialCoverageCheckbox.addEventListener('change', validateFieldAvailability);
}

// Event Listeners
btnGenerate.addEventListener('click', startGeneration);

// ===========================
// Info Panel
// ===========================
const ELEMENT_MAP_INFO = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };
const ELEMENT_EMOJI = { 'Metal': '🪙', 'Wood': '🪵', 'Water': '💧', 'Fire': '🔥', 'Earth': '🌍' };
const ZODIAC_MAP_INFO = {
    '鼠': 'Rat', '牛': 'Ox', '虎': 'Tiger', '兔': 'Rabbit',
    '龙': 'Dragon', '蛇': 'Snake', '马': 'Horse', '羊': 'Goat',
    '猴': 'Monkey', '鸡': 'Rooster', '狗': 'Dog', '猪': 'Pig'
};
const ZODIAC_EMOJI = {
    'Rat': '🐀', 'Ox': '🐂', 'Tiger': '🐅', 'Rabbit': '🐇',
    'Dragon': '🐉', 'Snake': '🐍', 'Horse': '🐎', 'Goat': '🐐',
    'Monkey': '🐒', 'Rooster': '🐓', 'Dog': '🐕', 'Pig': '🐖'
};

function formatSolarDate(solar) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[solar.getMonth() - 1]} ${solar.getDay()}, ${solar.getYear()}`;
}

function findLiChun(year) {
    for (let day = 3; day <= 5; day++) {
        const s = window.Solar.fromYmd(year, 2, day);
        if (s.getLunar().getJieQi() === '立春') return s;
    }
    return null;
}

function getYearInfo(lunarYear) {
    const ny = window.Lunar.fromYmd(lunarYear, 1, 1);
    const zodiacCn = ny.getYearShengXiao();
    const zodiac = ZODIAC_MAP_INFO[zodiacCn] || zodiacCn;
    const stem = ny.getYearGan();
    let elementChar = window.LunarUtil.WU_XING_GAN ? window.LunarUtil.WU_XING_GAN[stem] : undefined;
    if (!elementChar) {
        const wuXingStr = ny.getYearWuXing();
        elementChar = wuXingStr ? wuXingStr.charAt(0) : '';
    }
    const element = ELEMENT_MAP_INFO[elementChar] || elementChar;
    const ganzhi = ny.getYearInGanZhi();
    const solar = ny.getSolar();
    return { zodiac, element, ganzhi, solar };
}

function initInfoPanel() {
    const panel = document.getElementById('dynamicYearInfo');
    if (!panel || typeof window.Lunar === 'undefined') return;

    try {
        const today = new Date();
        const solarToday = window.Solar.fromDate(today);
        const lunarToday = solarToday.getLunar();
        const currentLunarYear = lunarToday.getYear();
        const cur = getYearInfo(currentLunarYear);

        // Next Li Chun
        let liChunYear = today.getFullYear();
        let liChunSolar = findLiChun(liChunYear);
        if (liChunSolar) {
            const liChunJs = new Date(liChunSolar.getYear(), liChunSolar.getMonth() - 1, liChunSolar.getDay());
            if (liChunJs <= today) {
                liChunSolar = findLiChun(liChunYear + 1);
            }
        }

        // Next Lunar New Year
        const nextYear = currentLunarYear + 1;
        const next = getYearInfo(nextYear);

        let html = '';

        // Current year
        html += `<div class="info-card mb-3 p-3 rounded">`;
        html += `<p class="mb-0"><strong>${currentLunarYear}</strong> is the year of `;
        html += `${cur.element} ${ELEMENT_EMOJI[cur.element] || ''} `;
        html += `${cur.zodiac} ${ZODIAC_EMOJI[cur.zodiac] || ''} `;
        html += `<span class="text-secondary">(${cur.ganzhi})</span>.</p>`;
        html += `</div>`;

        // Next Li Chun
        if (liChunSolar) {
            html += `<div class="info-card mb-3 p-3 rounded">`;
            html += `<p class="mb-0">Next <a href="https://en.wikipedia.org/wiki/Lichun" target="_blank">Lìchūn</a> `;
            html += `will be on <strong>${formatSolarDate(liChunSolar)}</strong>.</p>`;
            html += `</div>`;
        }

        // Next Lunar New Year
        html += `<div class="info-card mb-3 p-3 rounded">`;
        html += `<p class="mb-0">Next Lunar New Year will be on <strong>${formatSolarDate(next.solar)}</strong>. `;
        html += `It will be the year of `;
        html += `${next.element} ${ELEMENT_EMOJI[next.element] || ''} `;
        html += `${next.zodiac} ${ZODIAC_EMOJI[next.zodiac] || ''} `;
        html += `<span class="text-secondary">(${next.ganzhi})</span>.</p>`;
        html += `</div>`;

        panel.innerHTML = html;
    } catch (err) {
        console.error('Info panel error:', err);
        panel.innerHTML = '<p class="text-muted small">Could not load lunar data.</p>';
    }
}

// Initialize
const currentYear = new Date().getFullYear();
startYearInput.value = currentYear;
endYearInput.value = currentYear + 10;

startYearInput.addEventListener('input', validateFieldAvailability);
endYearInput.addEventListener('input', validateFieldAvailability);
document.querySelectorAll('.form-check-input').forEach(cb => {
    cb.addEventListener('change', validateFieldAvailability);
});

initTheme();
validateFieldAvailability(); // Initial check
initInfoPanel();
initWorker();
