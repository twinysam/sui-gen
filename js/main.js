/**
 * Sui-Gen Main Thread Logic
 * Handles UI interactions and Worker communication.
 */

// DOM Elements
const btnGenerate = document.getElementById('btnGenerate');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const progressBarContainer = document.getElementById('progressBarContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const codePreview = document.getElementById('codePreview');
const totalSize = document.getElementById('totalSize');
const previewLimit = document.getElementById('previewLimit');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');

// Worker Reference
let worker = null;
let generatedData = null;

// Initialize Worker
function initWorker() {
    if (window.Worker) {
        worker = new Worker('js/worker.js');
        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;
    } else {
        alert('Your browser does not support Web Workers. Sui-Gen requires Web Workers to function.');
        btnGenerate.disabled = true;
    }
}

// Handle Messages from Worker
function handleWorkerMessage(e) {
    const { type, data } = e.data;

    if (type === 'progress') {
        const { current, total, year } = data;
        const percent = Math.round((current / total) * 100);
        progressBar.style.width = `${percent}%`;
        statusText.textContent = `Processing Year ${year}... (${percent}%)`;
    } else if (type === 'complete') {
        generatedData = data;
        finishGeneration();
    } else if (type === 'error') {
        handleWorkerError({ message: data });
    }
}

// Handle Worker Errors
function handleWorkerError(error) {
    console.error('Worker Error:', error);
    statusText.textContent = `Error: ${error.message}`;
    resetUI();
    alert('An error occurred during generation. Check console for details.');
}

// Start Generation Process
function startGeneration() {
    const startYear = parseInt(document.getElementById('startYear').value, 10);
    const endYear = parseInt(document.getElementById('endYear').value, 10);
    
    // Validation
    if (isNaN(startYear) || isNaN(endYear)) {
        alert('Please enter valid start and end years.');
        return;
    }
    if (startYear > endYear) {
        alert('Start Year cannot be greater than End Year.');
        return;
    }

    // Gather Fields
    const fields = {
        cnyDate: document.getElementById('fieldCnyDate').checked,
        zodiac: document.getElementById('fieldZodiac').checked,
        element: document.getElementById('fieldElement').checked,
        ganzhi: document.getElementById('fieldGanzhi').checked,
        liChun: document.getElementById('fieldLiChun').checked,
        yearLength: document.getElementById('fieldYearLength').checked,
        leapMonth: document.getElementById('fieldLeapMonth').checked,
        newMoonUtc: document.getElementById('fieldNewMoonUtc').checked
    };

    // UI Updates
    btnGenerate.disabled = true;
    spinner.classList.remove('d-none');
    btnText.textContent = 'Generating...';
    progressBarContainer.style.display = 'flex';
    progressBar.style.width = '0%';
    statusText.textContent = 'Initializing Worker...';
    codePreview.textContent = 'Generating...';
    btnCopy.disabled = true;
    btnDownload.disabled = true;

    // Send to Worker
    worker.postMessage({
        cmd: 'generate',
        payload: { startYear, endYear, fields } // Send only necessary data
    });
}

// Finish Generation
function finishGeneration() {
    const jsonString = JSON.stringify(generatedData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const sizeKB = (blob.size / 1024).toFixed(2);

    // Update UI
    totalSize.textContent = `${sizeKB} KB`;
    
    // Preview Logic (First 50 lines)
    const lines = jsonString.split('\n');
    const previewContent = lines.slice(0, 50).join('\n') + (lines.length > 50 ? '\n... (truncated for preview)' : '');
    codePreview.textContent = previewContent;

    statusText.textContent = 'Generation Complete!';
    resetUI();
    
    // Enable Actions
    btnCopy.disabled = false;
    btnDownload.disabled = false;
    
    // Setup Download
    btnDownload.onclick = () => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sui-gen-manifest.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Setup Copy
    btnCopy.onclick = () => {
        navigator.clipboard.writeText(jsonString).then(() => {
            const originalText = btnCopy.textContent;
            btnCopy.textContent = 'Copied!';
            setTimeout(() => btnCopy.textContent = originalText, 2000);
        });
    };
}

// Reset UI State
function resetUI() {
    btnGenerate.disabled = false;
    spinner.classList.add('d-none');
    btnText.textContent = 'Generate Manifest';
    // Keep progress bar filled if complete, or hide if error/reset? 
    // Let's leave it visible but maybe change color or something if we want. 
    // For now, simple reset of button state.
}

// Event Listeners
btnGenerate.addEventListener('click', startGeneration);

// Initialize
initWorker();
