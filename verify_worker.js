const fs = require('fs');
const vm = require('vm');

try {
    console.log("--------------------------------------------------");
    console.log("Verifying Worker Logic (worker.js)...");

    // 1. Setup Sandbox
    const sandbox = {
        console: console,
        self: {},
        importScripts: function(path) {
            console.log(`[Worker] Importing ${path}...`);
            const libCode = fs.readFileSync('js/' + path, 'utf8');
            vm.runInContext(libCode, sandbox);
        },
        postMessage: function(msg) {
            if (msg.type === 'complete') {
                console.log("[Worker] Complete!");
                const data = msg.data; 
                // data is now an array
                const year2028 = data.find(d => d.year === 2028);
                
                if (year2028) {
                    console.log("2028 Data:", JSON.stringify(year2028, null, 2));
                    
                    const expectedCny = "2028-01-26";
                    const expectedMoonTime = "15:12";
                    
                    if (year2028.cny === expectedCny && 
                        year2028.newMoonUtc.includes(expectedMoonTime)) {
                        console.log("SUCCESS: 2028 New Moon is correct!");
                    } else {
                        console.error("FAILURE: 2028 calculations mismatch.");
                        console.error(`Expected CNY: ${expectedCny}, Got: ${year2028.cny}`);
                        console.error(`Expected ~${expectedMoonTime}, Got: ${year2028.newMoonUtc}`);
                    }
                } else {
                    console.error("FAILURE: 2028 data not found in response.");
                }

                // Verify Array Structure
                if (Array.isArray(data) && data.length > 0) {
                    console.log(`SUCCESS: Worker returned array with ${data.length} items.`);
                } else {
                    console.error("FAILURE: Worker did not return an array.");
                }
            } else if (msg.type === 'progress') {
                // console.log(`[Worker] Progress: ${msg.data.current}/${msg.data.total}`);
            } else if (msg.type === 'error') {
                console.error("[Worker] Error:", msg.data);
            }
        }
    };
    
    sandbox.self = sandbox; // self reference
    vm.createContext(sandbox);

    // 2. Load Worker Code
    const workerCode = fs.readFileSync('js/worker.js', 'utf8');
    vm.runInContext(workerCode, sandbox);

    // 3. Trigger Generation
    console.log("triggering generation for 2028...");
    sandbox.onmessage({
        data: {
            cmd: 'generate',
            payload: {
                startYear: 2028,
                endYear: 2028,
                fields: {
                    cnyDate: true,
                    zodiac: true,
                    element: true,
                    ganzhi: true,
                    liChun: true,
                    leapMonth: true,
                    newMoonUtc: true
                }
            }
        }
    });

} catch (err) {
    console.error("Verification Failed:", err);
}
