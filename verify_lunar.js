const fs = require('fs');
const vm = require('vm');

try {
    // 1. Load the library
    const lunarCode = fs.readFileSync('js/lunar.min.js', 'utf8');
    
    // 2. Create a context with a 'window' or 'self' object if needed, 
    // but usually these libs attach to global or 'this'.
    const sandbox = { 
        console: console,
        exports: {},
        module: { exports: {} },
        window: {},
        self: {}
    };
    
    vm.createContext(sandbox);
    vm.runInContext(lunarCode, sandbox);
    
    // Check if Lunar is available in various locations
    let Lunar = sandbox.Lunar || sandbox.window.Lunar || sandbox.global?.Lunar;
    let Solar = sandbox.Solar || sandbox.window.Solar;
    let LunarUtil = sandbox.LunarUtil || sandbox.window.LunarUtil;

    // Check CommonJS exports
    if (!Lunar && sandbox.module && sandbox.module.exports) {
        console.log("Checking module.exports...");
        const exports = sandbox.module.exports;
        Lunar = exports.Lunar || (exports.default && exports.default.Lunar);
        Solar = exports.Solar;
        LunarUtil = exports.LunarUtil;
        
        // Sometimes the library exports the Lunar class as the default or root
        if (!Lunar && typeof exports === 'function' && exports.name === 'Lunar') {
             Lunar = exports;
        }
    }

    if (!Lunar) {
        console.log("Sandbox Keys:", Object.keys(sandbox));
        console.log("Window Keys:", Object.keys(sandbox.window));
        if (sandbox.module) console.log("Module Exports Keys:", Object.keys(sandbox.module.exports));
        throw new Error("Lunar object not found in the library.");
    }

    console.log("Library loaded successfully.");

    // 3. Test Logic (Simulating Worker)
    const year = 2026;
    console.log(`Testing generation for year ${year}...`);

    // Phase 2: Precise Shuo Calculation Test
    console.log("--------------------------------------------------");
    console.log("Phase 2: Precise Shuo Calculation Test (With 1/3 Correction)");

    const ShouXingUtil = sandbox.module.exports.ShouXingUtil;
    const LunarMonth = sandbox.module.exports.LunarMonth;
    const Fn = { J2000: 2451545 };

    if (ShouXingUtil && LunarMonth) {
        const m = LunarMonth.fromYm(2028, 1);
        const approxJD = m.getFirstJulianDay();
        
        const k_est = Math.floor((approxJD + 14 - 2451551) / 29.5306);
        const radian = k_est * 2 * Math.PI;
        const preciseResult = ShouXingUtil.shuoHigh(radian);
        console.log(`Precise Result (Days from J2000 + 8h): ${preciseResult}`);
        
        // Remove Beijing Offset (1/3 day) and add J2000 base
        const ONE_THIRD = 1/3;
        const jdUTC = preciseResult - ONE_THIRD + Fn.J2000;
        console.log(`JD UTC: ${jdUTC}`);
        
        // Convert to Date
        // JD to Unix ms: (JD - 2440587.5) * 86400000
        const dateTimestamp = (jdUTC - 2440587.5) * 86400000;
        const date = new Date(dateTimestamp);
        console.log(`Precise Date (UTC): ${date.toISOString()}`);
        console.log("Expected: 2028-01-26T15:12:xxZ");
        
    } else {
        console.log("ShouXingUtil or LunarMonth not found.");
    }

} catch (err) {
    console.error("Verification Failed:", err);
}
