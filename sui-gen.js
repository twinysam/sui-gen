import fs from 'fs';
import { toJSON, toCSV, toYAML, toSQL, toMarkdown } from './js/formatters.js';

import pkg from './js/lunar.min.js';
const { Lunar, LunarYear, LunarUtil } = pkg;

// --- ARGS & PARSING ---
const args = process.argv.slice(2);
let startYear = 1900;
let endYear = 2100;
let format = 'json';
let fields = {
    cnyDate: true, zodiac: true, element: true, ganzhi: true,
    liChun: true, yearLength: true, leapMonth: true, newMoonUtc: true
};

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i+1]) startYear = parseInt(args[++i], 10);
    else if (args[i] === '--end' && args[i+1]) endYear = parseInt(args[++i], 10);
    else if (args[i] === '--format' && args[i+1]) format = args[++i].toLowerCase();
    else if (args[i] === '--fields' && args[i+1]) {
        const fInput = args[++i];
        if (fInput !== 'all') {
            // reset all to false, then selectively enable
            Object.keys(fields).forEach(k => fields[k] = false);
            fInput.split(',').forEach(f => {
                if (fields.hasOwnProperty(f.trim())) fields[f.trim()] = true;
            });
        }
    }
}

console.log(`\nSui-Gen CLI: Generating Calendar from ${startYear} to ${endYear} [Format: ${format.toUpperCase()}]`);

// --- CONSTANTS & MATH (from worker.js) ---
const FIELD_RANGES = {
    newMoonUtc: { hardBefore: 619, hardAfter: 17191 },
    liChun: { hardBefore: 619, hardAfter: 17191 },
    cnyDate: { hardBefore: 619, hardAfter: 17191 },
    leapMonth: { hardBefore: 619, hardAfter: 17191 },
    yearLength: { hardBefore: 619, hardAfter: 17191 },
    zodiac: { hardBefore: null, hardAfter: null },
    ganzhi: { hardBefore: null, hardAfter: null },
    element: { hardBefore: null, hardAfter: null },
};

function isWithinHardLimits(field, year) {
    const range = FIELD_RANGES[field];
    if (!range) return true;
    if (range.hardBefore !== null && year < range.hardBefore) return false;
    if (range.hardAfter !== null && year > range.hardAfter) return false;
    return true;
}

const ELEMENT_MAP = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };
const API_CACHE = new Map();

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
    let low = 0, high = 1, sign = Math.sign(y2 - y1);
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

async function fetchHorizonsChunked(target, sy, ey) {
    let allData = [];
    for (let y = sy; y <= ey; y += 100) {
        let chunkEnd = Math.min(y + 99, ey);
        const startStr = `${y}-01-01`;
        const endStr = `${chunkEnd + 1}-01-01`; 
        
        process.stdout.write(`Fetching ${target === '10' ? 'Sun' : 'Moon'} (${y}-${chunkEnd})...\r`);
        
        const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='${target}'&CENTER='500@399'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&START_TIME='${startStr}'&STOP_TIME='${endStr}'&STEP_SIZE='12 h'&QUANTITIES='31'`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const text = await res.text();
        
        const parsed = parseHorizonsData(text);
        if (parsed.length === 0) throw new Error("Could not parse Horizons data");
        
        if (allData.length > 0 && parsed.length > 0 && allData[allData.length-1].time === parsed[0].time) parsed.shift();
        allData = allData.concat(parsed);
    }
    process.stdout.write('\n');
    return allData;
}

// Fallbacks
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
const getBeijingMidnight = (utcMs) => {
    const d = new Date(utcMs + 8 * 3600000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600000;
};
function toBeijingYMD(utcMs) {
    const d = new Date(utcMs + 8 * 3600000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

(async () => {
    try {
        const sunData = await fetchHorizonsChunked('10', startYear - 1, endYear + 1);
        const moonData = await fetchHorizonsChunked('301', startYear - 1, endYear + 1);

        console.log("Calculating lunisolar nodes...");
        const newMoons = [];
        const solarTerms = [];
        
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

        const winterSolstices = solarTerms.filter(t => t.deg === 270);
        const globalMonths = [];
        
        for (let i = 0; i < winterSolstices.length - 1; i++) {
            let ws1 = winterSolstices[i].time;
            let ws2 = winterSolstices[i+1].time;
            
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
                
                let cycleMonths = globalMonths.slice(globalMonths.length - m);
                if (isLeapYear && !hasZq && !cycleMonths.some(x => x.isLeap)) {
                    let prevNum = globalMonths.length > 0 ? globalMonths[globalMonths.length-1].num : 11;
                    globalMonths.push({ num: prevNum, isLeap: true, start: sMs, end: eMs });
                } else {
                    globalMonths.push({ num: num, isLeap: false, start: sMs, end: eMs });
                    num++; if (num > 12) num = 1;
                }
            }
        }

        const data = [];
        for (let y = startYear; y <= endYear; y++) {
            const yearData = { year: y };
            let lunarNewYear = null;
            try { lunarNewYear = Lunar.fromYmd(y, 1, 1); } catch (e) {}

            let cnyMonth = globalMonths.find(m => m.num === 1 && !m.isLeap && new Date(m.start).getUTCFullYear() >= y-1 && new Date(m.start).getUTCMonth() >= 0 && new Date(m.start).getUTCMonth() <= 2 && new Date(m.start).getUTCFullYear() === y);
            if (!cnyMonth) cnyMonth = globalMonths.find(m => m.num === 1 && !m.isLeap && Math.abs(m.start - Date.UTC(y, 1, 1)) < 35 * 86400000);

            if (cnyMonth) {
                if (fields.cnyDate && isWithinHardLimits('cnyDate', y)) yearData.cny = toBeijingYMD(cnyMonth.start);
                if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', y)) {
                    yearData.newMoonUtc = new Date(cnyMonth.start).toISOString().replace('.000Z', 'Z');
                    yearData.newMoonUtcApproximate = false;
                }
                if (fields.yearLength && isWithinHardLimits('yearLength', y)) {
                    let nextCny = globalMonths.find(m => m.num === 1 && !m.isLeap && m.start > cnyMonth.start + 100*86400000);
                    if (nextCny) yearData.yearLength = Math.round((getBeijingMidnight(nextCny.start) - getBeijingMidnight(cnyMonth.start)) / 86400000);
                }
                if (fields.leapMonth && isWithinHardLimits('leapMonth', y)) {
                    let nextCny = globalMonths.find(m => m.num === 1 && !m.isLeap && m.start > cnyMonth.start + 100*86400000);
                    if (nextCny) {
                        let leapObj = globalMonths.find(m => m.isLeap && m.start >= cnyMonth.start && m.start < nextCny.start);
                        yearData.leapMonth = leapObj ? leapObj.num : null;
                    }
                }
            }

            if (fields.liChun && isWithinHardLimits('liChun', y)) {
                let liChun = solarTerms.find(t => t.deg === 315 && new Date(t.time).getUTCFullYear() === y);
                if (liChun) yearData.liChun = toBeijingYMD(liChun.time);
            }

            if (fields.zodiac) yearData.zodiac = isWithinHardLimits('zodiac', y) && lunarNewYear ? translateZodiac(lunarNewYear.getYearShengXiao()) : getZodiacArithmetic(y);
            if (fields.ganzhi) yearData.ganzhi = isWithinHardLimits('ganzhi', y) && lunarNewYear ? lunarNewYear.getYearInGanZhi() : getGanzhiArithmetic(y);
            
            if (fields.element) {
                if (isWithinHardLimits('element', y) && lunarNewYear) {
                    const stem = lunarNewYear.getYearGan();
                    let eChar = LunarUtil.WU_XING_GAN ? LunarUtil.WU_XING_GAN[stem] : undefined;
                    if (!eChar) {
                        const wxs = lunarNewYear.getYearWuXing();
                        eChar = wxs ? wxs.charAt(0) : stem;
                    }
                    yearData.element = ELEMENT_MAP[eChar] || eChar;
                } else yearData.element = getElementArithmetic(y);
            }

            data.push(yearData);
        }

        console.log(`Formatting as ${format.toUpperCase()}...`);
        let outStr = '';
        if (format === 'json') outStr = toJSON(data);
        else if (format === 'csv') outStr = toCSV(data);
        else if (format === 'yaml') outStr = toYAML(data);
        else if (format === 'sql') outStr = toSQL(data);
        else if (format === 'md') outStr = toMarkdown(data);
        
        const filename = `sui-gen-${startYear}-${endYear}.${format}`;
        fs.writeFileSync(filename, outStr);
        console.log(`Success! Data saved to ${filename}`);
        
    } catch (e) {
        console.error("Error generating calendar:", e);
    }
})();
