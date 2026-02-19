/**
 * Sui-Gen Web Worker
 * Handles heavy lunisolar calculations off the main thread.
 */

importScripts('lunar.min.js'); 

// Element Mapping (Chinese -> English)
const ELEMENT_MAP = {
    '金': 'Metal',
    '木': 'Wood',
    '水': 'Water',
    '火': 'Fire',
    '土': 'Earth'
};

// Reliability Tiers (Hard Limits and Warnings)
const FIELD_RANGES = {
    newMoonUtc: { warnBefore: null, warnAfter: 2050, hardBefore: 619, hardAfter: 2300 },
    liChun:     { warnBefore: null, warnAfter: null,  hardBefore: 619, hardAfter: 3000 },
    cnyDate:    { warnBefore: null, warnAfter: null,  hardBefore: 500, hardAfter: 3000 },
    leapMonth:  { warnBefore: null, warnAfter: null,  hardBefore: 500, hardAfter: 3000 },
    yearLength: { warnBefore: null, warnAfter: null,  hardBefore: 500, hardAfter: 3000 },
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

self.onmessage = function(e) {
    const { cmd, payload } = e.data;

    if (cmd === 'generate') {
        generateManifest(payload);
    }
};

// --- Arithmetic Fallbacks for Extreme Years ---
// These ensure cycle fields work even if the astronomical library crashes.

function getZodiacArithmetic(year) {
    const zodiacs = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];
    let index = (year - 4) % 12;
    if (index < 0) index += 12;
    return zodiacs[index];
}

function getGanzhiArithmetic(year) {
    const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    let sIndex = (year - 4) % 10;
    if (sIndex < 0) sIndex += 10;
    let bIndex = (year - 4) % 12;
    if (bIndex < 0) bIndex += 12;
    return stems[sIndex] + branches[bIndex];
}

function getElementArithmetic(year) {
    const elements = ['Wood', 'Wood', 'Fire', 'Fire', 'Earth', 'Earth', 'Metal', 'Metal', 'Water', 'Water'];
    let index = (year - 4) % 10;
    if (index < 0) index += 10;
    return elements[index];
}

function generateManifest({ startYear, endYear, fields }) {
    const total = endYear - startYear + 1;
    let current = 0;
    const data = [];

    for (let year = startYear; year <= endYear; year++) {
        try {
            const yearData = { year };
            let lunarNewYear = null;
            let solarObj = null;

            // Attempt to initialize library objects
            try {
                lunarNewYear = Lunar.fromYmd(year, 1, 1);
                solarObj = lunarNewYear.getSolar();
            } catch (libErr) {
                console.warn(`Library failed for year ${year}: ${libErr.message}. Using arithmetic fallbacks for cycle fields.`);
            }

            // CNY Date (Library Dependent)
            if (fields.cnyDate && isWithinHardLimits('cnyDate', year) && solarObj) {
                yearData.cny = solarObj.toYmd();
            }

            // Zodiac (Arithmetic Fallback available)
            if (fields.zodiac && isWithinHardLimits('zodiac', year)) {
                yearData.zodiac = lunarNewYear 
                    ? translateZodiac(lunarNewYear.getYearShengXiao())
                    : getZodiacArithmetic(year);
            }

            // Element (Arithmetic Fallback available)
            if (fields.element && isWithinHardLimits('element', year)) {
                if (lunarNewYear) {
                    const stem = lunarNewYear.getYearGan();
                    let elementChar = LunarUtil.WU_XING_GAN ? LunarUtil.WU_XING_GAN[stem] : undefined;
                    if (!elementChar) {
                        const wuXingStr = lunarNewYear.getYearWuXing();
                        elementChar = wuXingStr ? wuXingStr.charAt(0) : stem;
                    }
                    yearData.element = ELEMENT_MAP[elementChar] || elementChar;
                } else {
                    yearData.element = getElementArithmetic(year);
                }
            }

            // Ganzhi (Arithmetic Fallback available)
            if (fields.ganzhi && isWithinHardLimits('ganzhi', year)) {
                yearData.ganzhi = lunarNewYear 
                    ? lunarNewYear.getYearInGanZhi()
                    : getGanzhiArithmetic(year);
            }

            // Li Chun (Library Dependent)
            if (fields.liChun && isWithinHardLimits('liChun', year) && lunarNewYear) {
                const jieQiTable = lunarNewYear.getJieQiTable();
                if (jieQiTable['立春']) {
                    yearData.liChun = jieQiTable['立春'].toYmd();
                }
            }

            // Year Length and Leap Month (Library Dependent)
            if ((fields.yearLength || fields.leapMonth) && isWithinHardLimits('yearLength', year)) {
                try {
                    const lunarYearObj = LunarYear.fromYear(year);
                    if (fields.yearLength) yearData.yearLength = lunarYearObj.getDayCount();
                    if (fields.leapMonth) {
                        const lm = lunarYearObj.getLeapMonth();
                        yearData.leapMonth = lm > 0 ? lm : null;
                    }
                } catch (lyErr) {
                    console.warn(`LunarYear logic failed for ${year}: ${lyErr.message}`);
                }
            }

            // Precision Shuo (Library/Math safety net already exists)
            if (fields.newMoonUtc && isWithinHardLimits('newMoonUtc', year)) {
                const touchesWarnZone = (startYear <= FIELD_RANGES.newMoonUtc.hardAfter && endYear > FIELD_RANGES.newMoonUtc.warnAfter);
                if (touchesWarnZone) yearData.newMoonUtcApproximate = (year > FIELD_RANGES.newMoonUtc.warnAfter);

                try {
                    const monthObj = LunarMonth.fromYm(year, 1);
                    const firstJD = monthObj.getFirstJulianDay();
                    const k = Math.floor((firstJD + 14 - 2451551) / 29.5306);
                    const radian = k * 2 * Math.PI;
                    const preciseShuoBeijing = ShouXingUtil.shuoHigh(radian);
                    const jdUTC = preciseShuoBeijing - (1/3) + 2451545;
                    const dateTimestamp = (jdUTC - 2440587.5) * 86400000;
                    const candidate = new Date(dateTimestamp);
                    if (isNaN(candidate.getTime())) throw new Error('Invalid JD');
                    yearData.newMoonUtc = candidate.toISOString();
                } catch (e) {
                    if (solarObj) {
                        yearData.newMoonUtc = solarObj.toYmd() + "T00:00:00Z";
                        yearData.newMoonUtcApproximate = true;
                    } else {
                        // If solarObj also failed, we can't even provide an approximate date.
                        // This case should be rare if the initial Lunar.fromYmd fails.
                        console.warn(`Cannot determine newMoonUtc for ${year} due to library failure and no solarObj fallback.`);
                    }
                }
            }

            data.push(yearData);
        } catch (err) {
            console.error(`Skipping year ${year} due to critical error:`, err);
            // Year is omitted from data array, but loop continues
        }

        current++;
        if (current % 10 === 0 || current === total) { 
            self.postMessage({ type: 'progress', data: { current, total, year } });
        }
    }

    self.postMessage({ type: 'complete', data });
}

// Zodiac Translation
function translateZodiac(char) {
    const map = {
        '鼠': 'Rat', '牛': 'Ox', '虎': 'Tiger', '兔': 'Rabbit',
        '龙': 'Dragon', '蛇': 'Snake', '马': 'Horse', '羊': 'Goat',
        '猴': 'Monkey', '鸡': 'Rooster', '狗': 'Dog', '猪': 'Pig'
    };
    return map[char] || char;
}
