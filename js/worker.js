/**
 * Sui-Gen Web Worker
 * Handles heavy lunisolar calculations off the main thread.
 * Natively integrates JPL Horizons API for DE440/DE441 astronomical precision,
 * with lunar-javascript as an offline fallback.
 */

importScripts('lunar.min.js');

// --- HARD LIMITS & TIERS ---
const FIELD_RANGES = {
    newMoonUtc: { warnBefore: null, warnAfter: 2050, hardBefore: 619, hardAfter: 17191 },
    liChun:     { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17191 },
    cnyDate:    { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17191 },
    leapMonth:  { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17191 },
    yearLength: { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 17191 },
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

// --- CONSTANTS & CACHING ---
const ELEMENT_MAP = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };
const API_CACHE = new Map();

// --- MATH & ASTRONOMY UTILS ---
function normalizeAngle(deg) {
    let res = deg % 360;
    if (res < -180) res += 360;
    if (res >= 180) res -= 360;
    return res;
}

function cubicInterpolation(y0, y1, y2, y3, mu) {
    const mu2 = mu * mu;
    const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const a2 = -0.5 * y0 + 0.5 * y2;
    const a3 = y1;
    return a0 * mu * mu2 + a1 * mu2 + a2 * mu + a3;
}

function solveCubicRoot(y0, y1, y2, y3) {
    let low = 0, high = 1;
    let sign = Math.sign(y2 - y1);
    for (let iter = 0; iter < 50; iter++) {
        const mid = (low + high) / 2;
        const val = cubicInterpolation(y0, y1, y2, y3, mid);
        if (val * sign > 0) high = mid;
        else low = mid;
    }
    return (low + high) / 2;
}

function parseMonth(monStr) {
    const m = {Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11};
    return m[monStr];
}

function parseHorizonsData(text) {
    const parts = text.split('$$SOE');
    if (parts.length < 2) return [];
    const dataStr = parts[1].split('$$EOE')[0].trim();
    if (!dataStr) return [];
    
    const lines = dataStr.split('\n');
    const data = [];
    for (const line of lines) {
        const t = line.trim().split(/\s+/);
        if (t.length < 3) continue;
        const dateParts = t[0].split('-');
        const timeParts = t[1].split(':');
        const ts = Date.UTC(parseInt(dateParts[0]), parseMonth(dateParts[1]), parseInt(dateParts[2]), parseInt(timeParts[0]), parseInt(timeParts[1]));
        data.push({ time: ts, lon: parseFloat(t[2]) });
    }
    return data;
}

// --- JPL HORIZONS API CONFIG ---
// Modern browsers block direct access to NASA JPL due to lack of CORS headers.
// Cloudflare Worker proxy URL provided to enable precise online generation:
const JPL_API_BASE = 'https://sui-gen-cors.teaboymixing.workers.dev/';

async function fetchHorizonsChunked(target, startYear, endYear, progressBase, progressRange) {
    const key = `${target}_${startYear}_${endYear}`;
    if (API_CACHE.has(key)) return API_CACHE.get(key);

    const totalChunks = Math.ceil((endYear - startYear + 1) / 100);
    let chunkIdx = 0;
    let allData = [];
    const label = target === '10' ? 'Sun' : 'Moon';

    for (let y = startYear; y <= endYear; y += 100) {
        let chunkEnd = Math.min(y + 99, endYear);
        const startStr = `${y}-01-01`;
        const endStr = `${chunkEnd + 1}-01-01`; 
        
        const pct = Math.round(progressBase + (chunkIdx / totalChunks) * progressRange);
        self.postMessage({ type: 'progress', data: { current: pct, total: 100, status: `Fetching ${label} ephemerides (${y}–${chunkEnd})...` }});
        
        const url = `${JPL_API_BASE}?format=text&COMMAND='${target}'&CENTER='500@399'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&START_TIME='${startStr}'&STOP_TIME='${endStr}'&STEP_SIZE='12 h'&QUANTITIES='31'`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const text = await res.text();
        
        const parsed = parseHorizonsData(text);
        if (parsed.length === 0) throw new Error("Could not parse Horizons data");
        
        if (allData.length > 0 && parsed.length > 0 && allData[allData.length-1].time === parsed[0].time) parsed.shift();
        allData = allData.concat(parsed);
        chunkIdx++;
    }
    
    API_CACHE.set(key, allData);
    return allData;
}

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

// --- CALENDAR ENGINE ---
// Get local Beijing full date string YYYY-MM-DD
function toBeijingYMD(timestamp) {
    const d = new Date(timestamp + 8 * 3600000); // UTC+8
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

self.onmessage = async function(e) {
    const { cmd, payload } = e.data;
    if (cmd === 'generate') {
        try {
            await generateManifest(payload);
        } catch (err) {
            console.error(err);
            self.postMessage({ type: 'error', data: err.message });
        }
    }
};

async function generateManifest({ startYear, endYear, fields }) {
    let sunData, moonData;
    let isOffline = false;
    const data = [];
    const total = endYear - startYear + 1;

    try {
        // Phase 0: Initial connection
        self.postMessage({ type: 'progress', data: { current: 0, total: 100, status: 'Connecting to JPL Horizons...' } });

        // Phase 1: Fetch Sun (0–40%)
        sunData = await fetchHorizonsChunked('10', startYear - 1, endYear + 1, 0, 40);
        // Phase 2: Fetch Moon (40–80%)
        moonData = await fetchHorizonsChunked('301', startYear - 1, endYear + 1, 40, 40);
    } catch (apiErr) {
        console.warn(`JPL Horizons API failed: ${apiErr.message}. Falling back to offline lunar-javascript...`);
        isOffline = true;
    }

    if (isOffline) {
        generateManifestOffline({ startYear, endYear, fields, total });
        return;
    }

    // Phase 3: Interpolation & calendar construction (80%)
    self.postMessage({ type: 'progress', data: { current: 80, total: 100, status: 'Calculating lunar nodes and solar terms...' } });

    // 1. Calculate continuous solar terms & new moons
    const newMoons = [];
    const solarTerms = []; // { deg, time: ms }
    
    for (let i = 1; i < sunData.length - 2; i++) {
        let l1 = sunData[i].lon, l2 = sunData[i+1].lon;
        let pTerm = Math.floor(l1 / 15) * 15 + 15;
        if (pTerm === 360) pTerm = 0;
        
        let crossedTerm = (l1 < 360 && l2 < l1 && pTerm === 0) || (l1 < pTerm && l2 >= pTerm);
        if (crossedTerm) {
            let mu = solveCubicRoot(...[-1, 0, 1, 2].map(k => normalizeAngle(sunData[i+k].lon - pTerm)));
            solarTerms.push({ deg: pTerm, time: sunData[i].time + mu * (sunData[i+1].time - sunData[i].time) });
        }

        let d1 = normalizeAngle(moonData[i].lon - sunData[i].lon);
        let d2 = normalizeAngle(moonData[i+1].lon - sunData[i+1].lon);
        if (d1 <= 0 && d2 > 0) {
            let mu = solveCubicRoot(...[-1, 0, 1, 2].map(k => normalizeAngle(moonData[i+k].lon - sunData[i+k].lon)));
            newMoons.push(moonData[i].time + mu * (moonData[i+1].time - moonData[i].time));
        }
    }

    // Convert UTC ms to Beijing Start of Day ms (midnight UTC+8)
    const getBeijingMidnight = (utcMs) => {
        const d = new Date(utcMs + 8 * 3600000);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600000;
    };

    // 2. Build continuous timeline of Chinese Months
    const winterSolstices = solarTerms.filter(t => t.deg === 270);
    const globalMonths = [];
    
    for (let i = 0; i < winterSolstices.length - 1; i++) {
        let ws1 = winterSolstices[i].time;
        let ws2 = winterSolstices[i+1].time;
        
        // Find NM starting the month of WS1
        let nmStartIdx = newMoons.findIndex((nm, idx, arr) => nm <= ws1 && arr[idx+1] > ws1);
        let nmEndIdx = newMoons.findIndex((nm, idx, arr) => nm <= ws2 && arr[idx+1] > ws2);
        
        let mCount = nmEndIdx - nmStartIdx;
        let isLeapYear = mCount === 13;
        
        let num = 11;
        
        for (let m = 0; m < mCount; m++) {
            let sMs = newMoons[nmStartIdx + m];
            let eMs = newMoons[nmStartIdx + m + 1];
            
            let sDay = getBeijingMidnight(sMs);
            let eDay = getBeijingMidnight(eMs);
            let hasZq = solarTerms.some(t => t.deg % 30 === 0 && getBeijingMidnight(t.time) >= sDay && getBeijingMidnight(t.time) < eDay);
            
            let isLeap = false;
            // The leap month is the first month lacking a Zhongqi in a 13-month cycle
            // We check if we haven't already assigned a leap month in this cycle (meaning the last added isn't Leap of same cycle loop)
            // Actually, we can just check if we have a leap month between index nmStartIdx and here.
            let cycleMonths = globalMonths.slice(globalMonths.length - m);
            if (isLeapYear && !hasZq && !cycleMonths.some(x => x.isLeap)) {
                isLeap = true;
                let prevNum = globalMonths.length > 0 ? globalMonths[globalMonths.length-1].num : 11;
                globalMonths.push({ num: prevNum, isLeap: true, start: sMs, end: eMs });
            } else {
                globalMonths.push({ num: num, isLeap: false, start: sMs, end: eMs });
                num++; if (num > 12) num = 1;
            }
        }
    }

    // 3. Process Requested Years (80–100%)
    for (let y = startYear; y <= endYear; y++) {
        const pct = Math.round(80 + ((y - startYear) / total) * 20);
        self.postMessage({ type: 'progress', data: { current: pct, total: 100, year: y, status: `Assembling year ${y}...` } });
        try {
            const yearData = { year: y };
            let lunarNewYear = null;
            try { lunarNewYear = Lunar.fromYmd(y, 1, 1); } catch (e) {}

            // Find Chinese New Year (Month 1 of year Y)
            // Month 1 typically starts between Jan 21 and Feb 21 of year Y
            let cnyMonth = globalMonths.find(m => m.num === 1 && !m.isLeap && new Date(m.start).getUTCFullYear() >= y-1 && new Date(m.start).getUTCMonth() >= 0 && new Date(m.start).getUTCMonth() <= 2 && new Date(m.start).getUTCFullYear() === y);
            
            if (!cnyMonth) cnyMonth = globalMonths.find(m => m.num === 1 && !m.isLeap && Math.abs(m.start - Date.UTC(y, 1, 1)) < 35 * 86400000);

            if (cnyMonth) {
                if (fields.cnyDate && isWithinHardLimits('cnyDate', y)) {
                    yearData.cny = toBeijingYMD(cnyMonth.start);
                }
                if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', y)) {
                    yearData.newMoonUtc = new Date(cnyMonth.start).toISOString().replace('.000Z', 'Z');
                    yearData.newMoonUtcApproximate = false;
                }
                if (fields.yearLength && isWithinHardLimits('yearLength', y)) {
                    let nextCny = globalMonths.find(m => m.num === 1 && !m.isLeap && m.start > cnyMonth.start + 100*86400000);
                    if (nextCny) {
                        let cnyDay = getBeijingMidnight(cnyMonth.start);
                        let nextCnyDay = getBeijingMidnight(nextCny.start);
                        yearData.yearLength = Math.round((nextCnyDay - cnyDay) / 86400000);
                    }
                }
                if (fields.leapMonth && isWithinHardLimits('leapMonth', y)) {
                    let nextCny = globalMonths.find(m => m.num === 1 && !m.isLeap && m.start > cnyMonth.start + 100*86400000);
                    if (nextCny) {
                        let leapObj = globalMonths.find(m => m.isLeap && m.start >= cnyMonth.start && m.start < nextCny.start);
                        yearData.leapMonth = leapObj ? leapObj.num : null;
                    }
                }
            }

            // Li Chun
            if (fields.liChun && isWithinHardLimits('liChun', y)) {
                let liChun = solarTerms.find(t => t.deg === 315 && new Date(t.time).getUTCFullYear() === y);
                if (liChun) yearData.liChun = toBeijingYMD(liChun.time);
            }

            // Fallbacks for cycle fields
            if (fields.zodiac) {
                yearData.zodiac = isWithinHardLimits('zodiac', y) && lunarNewYear 
                    ? translateZodiac(lunarNewYear.getYearShengXiao()) 
                    : getZodiacArithmetic(y);
            }
            if (fields.ganzhi) {
                yearData.ganzhi = isWithinHardLimits('ganzhi', y) && lunarNewYear 
                    ? lunarNewYear.getYearInGanZhi() 
                    : getGanzhiArithmetic(y);
            }
            if (fields.element) {
                if (isWithinHardLimits('element', y) && lunarNewYear) {
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
    
    self.postMessage({ type: 'complete', data, isOffline });
}

function generateManifestOffline({ startYear, endYear, fields, total }) {
    const data = [];
    let current = 0;
    
    for (let year = startYear; year <= endYear; year++) {
        try {
            const yearData = { year };
            let lunarNewYear = null;
            let solarObj = null;

            try {
                lunarNewYear = Lunar.fromYmd(year, 1, 1);
                solarObj = lunarNewYear.getSolar();
            } catch (libErr) {
                console.warn(`Library failed for year ${year}.`);
            }

            if (fields.cnyDate && isWithinHardLimits('cnyDate', year) && solarObj) yearData.cny = solarObj.toYmd();
            
            if (fields.zodiac && isWithinHardLimits('zodiac', year)) {
                yearData.zodiac = lunarNewYear ? translateZodiac(lunarNewYear.getYearShengXiao()) : getZodiacArithmetic(year);
            }

            if (fields.element && isWithinHardLimits('element', year)) {
                if (lunarNewYear) {
                    const stem = lunarNewYear.getYearGan();
                    let elementChar = LunarUtil.WU_XING_GAN ? LunarUtil.WU_XING_GAN[stem] : undefined;
                    if (!elementChar) {
                        const wuXingStr = lunarNewYear.getYearWuXing();
                        elementChar = wuXingStr ? wuXingStr.charAt(0) : stem;
                    }
                    yearData.element = ELEMENT_MAP[elementChar] || elementChar;
                } else yearData.element = getElementArithmetic(year);
            }

            if (fields.ganzhi && isWithinHardLimits('ganzhi', year)) {
                yearData.ganzhi = lunarNewYear ? lunarNewYear.getYearInGanZhi() : getGanzhiArithmetic(year);
            }

            if (fields.liChun && isWithinHardLimits('liChun', year) && lunarNewYear) {
                const jieQiTable = lunarNewYear.getJieQiTable();
                if (jieQiTable['立春']) yearData.liChun = jieQiTable['立春'].toYmd();
            }

            if ((fields.yearLength || fields.leapMonth) && isWithinHardLimits('yearLength', year)) {
                try {
                    const lunarYearObj = LunarYear.fromYear(year);
                    if (fields.yearLength) yearData.yearLength = lunarYearObj.getDayCount();
                    if (fields.leapMonth) {
                        const lm = lunarYearObj.getLeapMonth();
                        yearData.leapMonth = lm > 0 ? lm : null;
                    }
                } catch (lyErr) {}
            }

            if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', year)) {
                if (solarObj) {
                    yearData.newMoonUtc = solarObj.toYmd() + "T00:00:00Z";
                    yearData.newMoonUtcApproximate = true;
                }
            }

            data.push(yearData);
        } catch (err) {}
        
        current++;
        if (current % 10 === 0 || current === total) { 
            self.postMessage({ type: 'progress', data: { current, total, year } });
        }
    }
    self.postMessage({ type: 'complete', data, isOffline: true });
}
