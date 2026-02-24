/**
 * Sui-Gen Web Worker
 * Handles heavy lunisolar calculations off the main thread.
 * Uses pre-computed JPL DE440/DE441 ephemeris data for years 619–17190,
 * with lunar-javascript as a fallback for dates outside that range.
 */

importScripts('lunar.min.js');

// --- HARD LIMITS & TIERS ---
const JPL_MIN_YEAR = 619;
const JPL_MAX_YEAR = 17190;

const FIELD_RANGES = {
    newMoonUtc: { warnBefore: null, warnAfter: 2050, hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    liChun:     { warnBefore: null, warnAfter: null,  hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    cnyDate:    { warnBefore: null, warnAfter: null,  hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    leapMonth:  { warnBefore: null, warnAfter: null,  hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    yearLength: { warnBefore: null, warnAfter: null,  hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    zodiac:     { warnBefore: null, warnAfter: null,  hardBefore: null, hardAfter: null },
    ganzhi:     { warnBefore: null, warnAfter: null,  hardBefore: null, hardAfter: null },
    element:    { warnBefore: null, warnAfter: null,  hardBefore: null, hardAfter: null },
};

function isWithinHardLimits(field, year) {
    const range = FIELD_RANGES[field];
    if (!range) return true;
    if (range.hardBefore !== null && year < range.hardBefore) return false;
    if (range.hardAfter !== null && year > range.hardAfter) return false;
    return true;
}

// --- CONSTANTS ---
const ELEMENT_MAP = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };

// --- PRE-COMPUTED DATA ---
// Indexed by gregorian_year for O(1) lookup. Populated via message from main thread or fetch.
let jplDataMap = null;

// --- CYCLE FALLBACKS ---
function getZodiacArithmetic(year) {
    const z = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];
    let idx = (year - 4) % 12;
    return z[idx < 0 ? idx + 12 : idx];
}
function getGanzhiArithmetic(year) {
    const s = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const b = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    let si = (year - 4) % 10;
    let bi = (year - 4) % 12;
    return s[si < 0 ? si + 10 : si] + b[bi < 0 ? bi + 12 : bi];
}
function getElementArithmetic(year) {
    const e = ['Wood', 'Wood', 'Fire', 'Fire', 'Earth', 'Earth', 'Metal', 'Metal', 'Water', 'Water'];
    let idx = (year - 4) % 10;
    return e[idx < 0 ? idx + 10 : idx];
}

function translateZodiac(char) {
    const map = { '鼠': 'Rat', '牛': 'Ox', '虎': 'Tiger', '兔': 'Rabbit', '龙': 'Dragon', '蛇': 'Snake', '马': 'Horse', '羊': 'Goat', '猴': 'Monkey', '鸡': 'Rooster', '狗': 'Dog', '猪': 'Pig' };
    return map[char] || char;
}

// --- MESSAGE HANDLER ---
self.onmessage = async function(e) {
    const { cmd, payload } = e.data;
    if (cmd === 'generate') {
        try {
            // Accept pre-loaded JPL data from main thread if provided
            if (payload.jplData && !jplDataMap) {
                buildJplIndex(payload.jplData);
            }
            await generateManifest(payload);
        } catch (err) {
            console.error(err);
            self.postMessage({ type: 'error', data: err.message });
        }
    }
};

function buildJplIndex(dataArray) {
    jplDataMap = new Map();
    for (const entry of dataArray) {
        jplDataMap.set(entry.gregorian_year, entry);
    }
}

async function ensureJplData() {
    if (jplDataMap) return;
    // Fallback: fetch the JSON if the main thread didn't provide it
    self.postMessage({ type: 'progress', data: { current: 0, total: 100, status: 'Loading pre-computed ephemeris data...' } });
    try {
        const res = await fetch('sui-gen-jpl-source_619-17190.json');
        if (!res.ok) throw new Error(`Failed to load JPL data: ${res.status}`);
        const data = await res.json();
        buildJplIndex(data);
    } catch (err) {
        console.warn('Could not load pre-computed JPL data:', err.message);
        // jplDataMap stays null; we'll fall back to lunar-javascript
    }
}

// --- MAIN GENERATION ---
async function generateManifest({ startYear, endYear, fields, partialCoverage }) {
    await ensureJplData();

    const data = [];
    const total = endYear - startYear + 1;

    self.postMessage({ type: 'progress', data: { current: 5, total: 100, status: 'Assembling calendar data...' } });

    for (let y = startYear; y <= endYear; y++) {
        // Progress: starts at 5% (JPL loaded), ends at 100%
        const pct = Math.round(5 + ((y - startYear + 1) / total) * 95);
        if ((y - startYear) % 50 === 0 || y === endYear) {
            self.postMessage({ type: 'progress', data: { current: Math.min(pct, 100), total: 100, status: `Processing year ${y}...` } });
        }

        try {
            const yearData = { year: y };
            const jplEntry = jplDataMap ? jplDataMap.get(y) : null;

            if (jplEntry) {
                // --- JPL pre-computed data available ---
                if (fields.cnyDate && isWithinHardLimits('cnyDate', y)) {
                    yearData.cny = jplEntry.cnyDate;
                }
                if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', y)) {
                    yearData.newMoonUtc = jplEntry.newMoonUtc;
                }
                if (fields.liChun && isWithinHardLimits('liChun', y)) {
                    yearData.liChun = jplEntry.liChun;
                }
                if (fields.yearLength && isWithinHardLimits('yearLength', y)) {
                    yearData.yearLength = jplEntry.yearLength;
                }
                if (fields.leapMonth && isWithinHardLimits('leapMonth', y)) {
                    yearData.leapMonth = jplEntry.leapMonth;
                }
            } else if (partialCoverage) {
                // Partial coverage mode: output null for astronomical fields outside JPL range
                if (fields.cnyDate) yearData.cny = null;
                if (fields.newMoonUtc) yearData.newMoonUtc = null;
                if (fields.liChun) yearData.liChun = null;
                if (fields.yearLength) yearData.yearLength = null;
                if (fields.leapMonth) yearData.leapMonth = null;
            }
            // If not in partialCoverage and no jplEntry, astronomical fields are simply omitted from yearData

            // Cycle fields (always computed arithmetically, reliable for any year)
            let lunarNewYear = null;
            try { lunarNewYear = Lunar.fromYmd(y, 1, 1); } catch (e) {}

            if (fields.zodiac) {
                yearData.zodiac = lunarNewYear
                    ? translateZodiac(lunarNewYear.getYearShengXiao())
                    : getZodiacArithmetic(y);
            }
            if (fields.ganzhi) {
                yearData.ganzhi = lunarNewYear
                    ? lunarNewYear.getYearInGanZhi()
                    : getGanzhiArithmetic(y);
            }
            if (fields.element) {
                if (lunarNewYear) {
                    const stem = lunarNewYear.getYearGan();
                    let eChar = LunarUtil.WU_XING_GAN ? LunarUtil.WU_XING_GAN[stem] : undefined;
                    if (!eChar) {
                        const wxs = lunarNewYear.getYearWuXing();
                        eChar = wxs ? wxs.charAt(0) : stem;
                    }
                    yearData.element = ELEMENT_MAP[eChar] || eChar;
                } else {
                    yearData.element = getElementArithmetic(y);
                }
            }

            data.push(yearData);
        } catch (e) {
            console.error(`Error processing year ${y}:`, e);
        }
    }

    // Determine if any years fell outside JPL range
    const hasOutOfRange = startYear < JPL_MIN_YEAR || endYear > JPL_MAX_YEAR;
    self.postMessage({ type: 'complete', data, usedFallback: hasOutOfRange });
}

