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
    const data = {};
    const total = endYear - startYear + 1;
    let current = 0;
    
    // Performance optimization: Helper structure to avoid repeated lookups if possible
    // But typical usage is efficient enough.

    try {
        for (let year = startYear; year <= endYear; year++) {
            // 1. Get Lunar New Year (Day 1 of Month 1)
            const lunarNewYear = Lunar.fromYmd(year, 1, 1);
            const solarObj = lunarNewYear.getSolar();
            
            const yearData = {};
            
            // CNY Date
            if (fields.cnyDate) {
                yearData.cnyDate = solarObj.toYmd();
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
                const elementChar = LunarUtil.WU_XING_GAN[stem];
                yearData.element = ELEMENT_MAP[elementChar] || elementChar;
            }
            
            // Ganzhi
            if (fields.ganzhi) {
                yearData.ganzhi = lunarNewYear.getYearInGanZhi();
            }
            
            // Li Chun Date
            if (fields.liChun) {
                // Li Chun is a JieQi.
                const jieQiTable = lunarNewYear.getJieQiTable();
                const liChunSolar = jieQiTable['立春'];
                if (liChunSolar) {
                    yearData.liChun = liChunSolar.toYmd();
                }
            }
            
            // Year Length (in days)
            if (fields.yearLength) {
                // Diff next CNY - this CNY
                const nextLunarNewYear = Lunar.fromYmd(year + 1, 1, 1).getSolar();
                const diffTime = Math.abs(new Date(nextLunarNewYear.toYmd()) - new Date(solarObj.toYmd()));
                yearData.yearLength = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            }
            
            // Leap Month
            if (fields.leapMonth) {
                // Strategy: Scan the year's lunar months.
                // Start from Lunar New Year, jump by 29 days, check month index.
                // If negative, it's a leap month.
                let leapMonth = 0;
                
                // We clone the start date via Solar to iterate safely
                let scanDate = solarObj;
                
                // We scan up to 14 times (covering >380 days) to be safe
                for (let i = 0; i < 14; i++) {
                     // Check current Lunar Month
                     const l = Lunar.fromSolar(scanDate);
                     const m = l.getMonth();
                     
                     // Check if this date is still in the same Lunar Year
                     // (Wait, Lunar Year might change? Yes, if we go past end)
                     if (l.getYear() !== year) {
                         // We went past the year, stop.
                         break;
                     }
                     
                     if (m < 0) {
                         leapMonth = Math.abs(m);
                         break; // Found it
                     }
                     
                     // Advance 29 days (min lunar month length)
                     // Using SolarUtil or just JS Date
                     const jsDate = new Date(scanDate.toYmd());
                     jsDate.setDate(jsDate.getDate() + 29);
                     scanDate = Solar.fromYmd(jsDate.getFullYear(), jsDate.getMonth() + 1, jsDate.getDate());
                }
                yearData.leapMonth = leapMonth;
            }
            
            // New Moon UTC
            if (fields.newMoonUtc) {
                // Precision Astronomical New Moon (Shuo)
                try {
                    // 1. Get LunarMonth for the 1st month of the year
                    // Note: Lunar.fromYmd(year, 1, 1) is Day 1 of Month 1.
                    const monthObj = LunarMonth.fromYm(year, 1);
                    const firstJD = monthObj.getFirstJulianDay();

                    // 2. Calculate approximate Lunation Number (k)
                    // Formula derived from library's calcShuo logic
                    const k = Math.floor((firstJD + 14 - 2451551) / 29.5306);

                    // 3. Calculate Precision Shuo (Days since J2000 + 8h offset)
                    const radian = k * 2 * Math.PI;
                    const preciseShuoBeijing = ShouXingUtil.shuoHigh(radian);

                    // 4. Convert to UTC Julian Day
                    // Remove 1/3 day (8h) Beijing offset, add J2000 base
                    const jdUTC = preciseShuoBeijing - (1/3) + 2451545;

                    // 5. Convert to ISO String
                    const dateTimestamp = (jdUTC - 2440587.5) * 86400000;
                    yearData.newMoonUtc = new Date(dateTimestamp).toISOString();

                } catch (e) {
                    // Fallback to simple date if precision fails (should not happen)
                    yearData.newMoonUtc = solarObj.toYmd() + "T00:00:00Z";
                    console.error(`Precision Shuo failed for ${year}:`, e);
                } 
            }

            // Populate Main Object
            data[year] = yearData;

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
