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
            Object.keys(fields).forEach(k => fields[k] = false);
            fInput.split(',').forEach(f => {
                if (fields.hasOwnProperty(f.trim())) fields[f.trim()] = true;
            });
        }
    }
}

console.log(`\nSui-Gen CLI: Generating Calendar from ${startYear} to ${endYear} [Format: ${format.toUpperCase()}]`);

// --- CONSTANTS ---
const JPL_MIN_YEAR = 619;
const JPL_MAX_YEAR = 17190;

const FIELD_RANGES = {
    newMoonUtc: { hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    liChun: { hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    cnyDate: { hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    leapMonth: { hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
    yearLength: { hardBefore: JPL_MIN_YEAR, hardAfter: JPL_MAX_YEAR },
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

// --- LOAD PRE-COMPUTED JPL DATA ---
console.log("Loading pre-computed JPL DE440/DE441 ephemeris data...");
const jplRaw = JSON.parse(fs.readFileSync('sui-gen-jpl-source_619-17190.json', 'utf8'));
const jplDataMap = new Map();
for (const entry of jplRaw) {
    jplDataMap.set(entry.gregorian_year, entry);
}
console.log(`Loaded ${jplDataMap.size} years of pre-computed data (${JPL_MIN_YEAR}-${JPL_MAX_YEAR}).`);

// --- GENERATE ---
const data = [];
for (let y = startYear; y <= endYear; y++) {
    if (y % 500 === 0) process.stdout.write(`Processing year ${y}...\r`);

    const yearData = { year: y };
    const jplEntry = jplDataMap.get(y);

    if (jplEntry) {
        // Pre-computed JPL data available
        if (fields.cnyDate && isWithinHardLimits('cnyDate', y)) yearData.cny = jplEntry.cnyDate;
        if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', y)) {
            yearData.newMoonUtc = jplEntry.newMoonUtc;
            yearData.newMoonUtcApproximate = false;
        }
        if (fields.liChun && isWithinHardLimits('liChun', y)) yearData.liChun = jplEntry.liChun;
        if (fields.yearLength && isWithinHardLimits('yearLength', y)) yearData.yearLength = jplEntry.yearLength;
        if (fields.leapMonth && isWithinHardLimits('leapMonth', y)) yearData.leapMonth = jplEntry.leapMonth;
    } else {
        // Fallback to lunar-javascript for years outside JPL range
        let lunarNewYear = null;
        let solarObj = null;
        try {
            lunarNewYear = Lunar.fromYmd(y, 1, 1);
            solarObj = lunarNewYear.getSolar();
        } catch (e) {}

        if (fields.cnyDate && isWithinHardLimits('cnyDate', y) && solarObj) yearData.cny = solarObj.toYmd();
        if (fields.liChun && isWithinHardLimits('liChun', y) && lunarNewYear) {
            const jieQiTable = lunarNewYear.getJieQiTable();
            if (jieQiTable['立春']) yearData.liChun = jieQiTable['立春'].toYmd();
        }
        if ((fields.yearLength || fields.leapMonth) && isWithinHardLimits('yearLength', y)) {
            try {
                const lunarYearObj = LunarYear.fromYear(y);
                if (fields.yearLength) yearData.yearLength = lunarYearObj.getDayCount();
                if (fields.leapMonth) {
                    const lm = lunarYearObj.getLeapMonth();
                    yearData.leapMonth = lm > 0 ? lm : null;
                }
            } catch (e) {}
        }
        if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', y) && solarObj) {
            yearData.newMoonUtc = solarObj.toYmd() + "T00:00:00Z";
            yearData.newMoonUtcApproximate = true;
        }
    }

    // Cycle fields (always reliable)
    let lunarNewYear = null;
    try { lunarNewYear = Lunar.fromYmd(y, 1, 1); } catch (e) {}

    if (fields.zodiac) yearData.zodiac = lunarNewYear ? translateZodiac(lunarNewYear.getYearShengXiao()) : getZodiacArithmetic(y);
    if (fields.ganzhi) yearData.ganzhi = lunarNewYear ? lunarNewYear.getYearInGanZhi() : getGanzhiArithmetic(y);

    if (fields.element) {
        if (lunarNewYear) {
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

console.log(`\nFormatting as ${format.toUpperCase()}...`);
let outStr = '';
if (format === 'json') outStr = toJSON(data);
else if (format === 'csv') outStr = toCSV(data);
else if (format === 'yaml') outStr = toYAML(data);
else if (format === 'sql') outStr = toSQL(data);
else if (format === 'md') outStr = toMarkdown(data);

const filename = `sui-gen-${startYear}-${endYear}.${format}`;
fs.writeFileSync(filename, outStr);
console.log(`Success! Data saved to ${filename}`);
