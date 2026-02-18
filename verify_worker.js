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
                // Inspect 2028 data
                const y2028 = msg.data[2028];
                if (y2028) {
                    console.log("2028 Data:", JSON.stringify(y2028, null, 2));
                    if (y2028.newMoonUtc && y2028.newMoonUtc.includes("15:12")) {
                        console.log("SUCCESS: 2028 New Moon is correct!");
                    } else {
                        console.log("FAILURE: 2028 New Moon mismatch (Expected ~15:12)");
                    }
                } else {
                    console.log("FAILURE: 2028 data missing.");
                }
            } else if (msg.type === 'error') {
                console.error("[Worker] Error:", msg.data);
            } else if (msg.type === 'progress') {
                // console.log(`[Worker] Progress: ${msg.data.current}/${msg.data.total}`);
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
