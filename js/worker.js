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

self.onmessage = function(e) {
    const { cmd, payload } = e.data;

    if (cmd === 'generate') {
        generateManifest(payload);
    }
};

function generateManifest({ startYear, endYear, fields }) {
    const data = [];
    const total = endYear - startYear + 1;
    let current = 0;
    
    // Performance optimization: Helper structure to avoid repeated lookups if possible
    // But typical usage is efficient enough.

    try {
        for (let year = startYear; year <= endYear; year++) {
            // 1. Get Lunar New Year (Day 1 of Month 1)
            const lunarNewYear = Lunar.fromYmd(year, 1, 1);
            const solarObj = lunarNewYear.getSolar();
            
            const yearData = { year };
            
            // CNY Date
            if (fields.cnyDate) {
                yearData.cny = solarObj.toYmd();
            }
            
            // Zodiac (Sheng Xiao)
            // Note: getYearShengXiao() returns Chinese char. 
            // The library output is Chinese. 
            // Ideally we map to English if the user expects English.
            // The prompt example showed "Horse".
            if (fields.zodiac) {
                yearData.zodiac = translateZodiac(lunarNewYear.getYearShengXiao());
            }
            
            // Element (Wu Xing)
            if (fields.element) {
                const stem = lunarNewYear.getYearGan();
                let elementChar = LunarUtil.WU_XING_GAN ? LunarUtil.WU_XING_GAN[stem] : undefined;
                if (!elementChar) {
                    // Fallback: extract first char from getYearWuXing() (e.g. '金水' -> '金')
                    const wuXingStr = lunarNewYear.getYearWuXing();
                    elementChar = wuXingStr ? wuXingStr.charAt(0) : stem;
                }
                yearData.element = ELEMENT_MAP[elementChar] || elementChar;
            }
            
            // Ganzhi
            if (fields.ganzhi) {
                yearData.ganzhi = lunarNewYear.getYearInGanZhi();
            }
            
            if (fields.liChun) {
                const jieQiTable = lunarNewYear.getJieQiTable();
                if (jieQiTable['立春']) {
                    yearData.liChun = jieQiTable['立春'].toYmd();
                }
            }
            
            // Year Length and Leap Month
            // Use LunarYear for efficient native lookups
            const lunarYearObj = LunarYear.fromYear(year);
            
            if (fields.yearLength) {
                yearData.yearLength = lunarYearObj.getDayCount();
            }
            
            if (fields.leapMonth) {
                const lm = lunarYearObj.getLeapMonth();
                yearData.leapMonth = lm > 0 ? lm : null;
            }
            
            if (fields.newMoonUtc) {
                // Precision Astronomical New Moon (Shuo)
                try {
                    const monthObj = LunarMonth.fromYm(year, 1);
                    const firstJD = monthObj.getFirstJulianDay();

                    // Calculate approximate Lunation Number (k)
                    const k = Math.floor((firstJD + 14 - 2451551) / 29.5306);

                    // Calculate Precision Shuo (Days since J2000 + 8h offset)
                    const radian = k * 2 * Math.PI;
                    const preciseShuoBeijing = ShouXingUtil.shuoHigh(radian);

                    // Convert to UTC Julian Day
                    const jdUTC = preciseShuoBeijing - (1/3) + 2451545;

                    // Convert to ISO String and validate
                    const dateTimestamp = (jdUTC - 2440587.5) * 86400000;
                    const candidate = new Date(dateTimestamp);
                    
                    if (isNaN(candidate.getTime())) {
                        throw new Error('Invalid date from JD calculation');
                    }
                    
                    yearData.newMoonUtc = candidate.toISOString();

                } catch (e) {
                    // Fall back to CNY date at midnight UTC and flag as approximate
                    yearData.newMoonUtc = solarObj.toYmd() + "T00:00:00Z";
                    yearData.newMoonUtcApproximate = true;
                    console.warn(`Precision Shuo fell back for ${year}:`, e.message || e);
                } 
            }

            // Populate Main Object
            data.push(yearData);

            // Progress Update
            current++;
            if (current % 5 === 0 || current === total) { 
                self.postMessage({
                    type: 'progress',
                    data: { current, total, year }
                });
            }
        }

        // Complete
        self.postMessage({
            type: 'complete',
            data: data
        });

    } catch (err) {
        self.postMessage({
            type: 'error',
            data: err.message
        });
    }
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
