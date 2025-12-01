// --- Configuration & State ---
const CONFIG = {
    daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    mealTypes: ["Breakfast", "Lunch", "Dinner"],
    dimensions: { cx: 250, cy: 250, rHub: 70, rSplit: 140, rOuter: 200, rText: 230 },
    colors: {
        light: ["#ffadad", "#ffd6a5", "#fdffb6", "#e4ffc1", "#9bf6ff", "#a0c4ff", "#bdb2ff"],
        dark: ["#ef4444", "#f97316", "#eab308", "#84cc16", "#06b6d4", "#3b82f6", "#8b5cf6"]
    },
    pin: "1234"
};

const DB_NAME = 'PillDispenserDB';
const DB_VERSION = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Create a store for logs if it doesn't exist
            if (!db.objectStoreNames.contains('logs')) {
                const store = db.createObjectStore('logs', { keyPath: 'timestamp' }); // timestamp as unique ID
                store.createIndex('type', 'type', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log("Local Database Initialized");
            resolve(db);
        };
        
        request.onerror = (event) => reject("DB Error");
    });
}

function saveLog(logEntry) {
    // logEntry expected format: { timestamp: 1716xxxxxx, message: "Pill Dispensed", type: "dispense" }
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    store.put(logEntry); // .put updates if exists, adds if new
}

function getAllLogs() {
    return new Promise((resolve) => {
        const transaction = db.transaction(['logs'], 'readonly');
        const store = transaction.objectStore('logs');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

let state = {
    selectedPills: new Set(),
    timings: { breakfast: "08:00", lunch: "13:00", dinner: "20:00" },
    device: {
        ip: "192.168.4.1", // Default SoftAP IP
        password: "",
        isConnected: false,
        lastLogFetch: 0
    },
    heartbeatInterval: null,
    isAuthenticated: false
};

// --- DOM Elements ---
const dom = {
    svg: document.getElementById('dispenser-svg'),
    hub: {
        display: document.getElementById('hub-display'),
        label: document.querySelector('.center-hub .hub-label'),
        value: document.querySelector('.center-hub .hub-value'),
        status: document.querySelector('.center-hub .hub-status')
    },
    summary: {
        text: document.getElementById('summary-text'),
        list: document.getElementById('summary-list'),
        clearBtn: document.getElementById('btn-clear')
    },
    saveBtn: document.getElementById('btn-save'),
    modals: {
        settings: document.getElementById('settings-modal'),
        wifi: document.getElementById('wifi-modal'),
        logs: document.getElementById('logs-modal')
    },
    inputs: {
        bk: document.getElementById('time-breakfast'),
        ln: document.getElementById('time-lunch'),
        dn: document.getElementById('time-dinner'),
        ip: document.getElementById('device-ip'),
        pass: document.getElementById('device-pass')
    },
    logs: {
        container: document.getElementById('log-container'),
        refreshBtn: document.getElementById('btn-refresh-logs')
    },
    indicators: {
        wifiDot: document.getElementById('wifi-status-dot'),
        connMsg: document.getElementById('connection-msg')
    }
};

// --- Geometry & Initialization (Same as previous, shortened for brevity) ---
function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return { x: centerX + (radius * Math.cos(angleInRadians)), y: centerY + (radius * Math.sin(angleInRadians)) };
}

function describeArc(x, y, radius, innerRadius, startAngle, endAngle) {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const startInner = polarToCartesian(x, y, innerRadius, endAngle);
    const endInner = polarToCartesian(x, y, innerRadius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return ["M", startInner.x, startInner.y, "L", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y, "L", endInner.x, endInner.y, "A", innerRadius, innerRadius, 0, largeArcFlag, 1, startInner.x, startInner.y, "Z"].join(" ");
}

function lightenColor(hex, percent) {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

function initDispenser() {
    const numSegments = 21;
    for (let i = 0; i < numSegments; i++) {
        const startAngle = (360 / numSegments) * i;
        const endAngle = (360 / numSegments) * (i + 1);
        const dayIndex = Math.floor(i / 3);
        const mealIndex = i % 3;
        const currentDay = CONFIG.daysOfWeek[dayIndex];
        const currentMeal = CONFIG.mealTypes[mealIndex];
        const baseColor = CONFIG.colors.light[dayIndex];
        const activeColor = CONFIG.colors.dark[dayIndex];
        const idBase = `${currentDay}-${currentMeal}`;

        // Before Meal
        createSection({
            id: `${idBase}-Before`, label: currentMeal, subLabel: `${currentDay} (Before)`,
            rInner: CONFIG.dimensions.rHub, rOuter: CONFIG.dimensions.rSplit,
            start: startAngle, end: endAngle, fill: lightenColor(baseColor, 15), activeColor: activeColor, sortIndex: i * 2
        });
        // After Meal
        createSection({
            id: `${idBase}-After`, label: currentMeal, subLabel: `${currentDay} (After)`,
            rInner: CONFIG.dimensions.rSplit, rOuter: CONFIG.dimensions.rOuter,
            start: startAngle, end: endAngle, fill: baseColor, activeColor: activeColor, sortIndex: (i * 2) + 1
        });
        if (i % 3 === 0) {
            drawDayLabel(startAngle, numSegments, currentDay);
            drawSeparator(startAngle);
        }
        drawRimNumber(i + 1, startAngle, endAngle);
    }
}

function createSection(cfg) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", describeArc(CONFIG.dimensions.cx, CONFIG.dimensions.cy, cfg.rOuter, cfg.rInner, cfg.start, cfg.end));
    path.setAttribute("class", "pill-section");
    path.setAttribute("fill", cfg.fill);
    Object.assign(path.dataset, { id: cfg.id, originalFill: cfg.fill, activeFill: cfg.activeColor, label: cfg.label, sub: cfg.subLabel, sortIndex: cfg.sortIndex });
    path.addEventListener('click', (e) => toggleSelection(e.target));
    path.addEventListener('mouseenter', (e) => updateHubHover(e.target));
    path.addEventListener('mouseleave', clearHub);
    dom.svg.appendChild(path);
}

// Drawing helpers (drawDayLabel, drawRimNumber, drawSeparator) same as before...
function drawDayLabel(startAngle, numSegments, dayName) {
    const dayMidAngle = startAngle + ((360 / numSegments) * 3) / 2;
    const pos = polarToCartesian(CONFIG.dimensions.cx, CONFIG.dimensions.cy, CONFIG.dimensions.rText, dayMidAngle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", pos.x); text.setAttribute("y", pos.y);
    text.setAttribute("class", "day-label");
    text.setAttribute("transform", `rotate(${dayMidAngle + 90}, ${pos.x}, ${pos.y})`);
    text.textContent = dayName.toUpperCase();
    dom.svg.appendChild(text);
}

function drawRimNumber(num, startAngle, endAngle) {
    const midAngle = startAngle + (endAngle - startAngle) / 2;
    const pos = polarToCartesian(CONFIG.dimensions.cx, CONFIG.dimensions.cy, CONFIG.dimensions.rOuter + 10, midAngle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", pos.x); text.setAttribute("y", pos.y);
    text.setAttribute("class", "rim-label");
    text.setAttribute("transform", `rotate(${midAngle + 90}, ${pos.x}, ${pos.y})`);
    text.textContent = num;
    dom.svg.appendChild(text);
}

function drawSeparator(angle) {
    const start = polarToCartesian(CONFIG.dimensions.cx, CONFIG.dimensions.cy, CONFIG.dimensions.rOuter + 5, angle);
    const end = polarToCartesian(CONFIG.dimensions.cx, CONFIG.dimensions.cy, CONFIG.dimensions.rText + 15, angle);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", start.x); line.setAttribute("y1", start.y); line.setAttribute("x2", end.x); line.setAttribute("y2", end.y);
    line.setAttribute("class", "day-separator");
    dom.svg.appendChild(line);
}

// --- Interaction Logic ---
function toggleSelection(el) {
    const id = el.dataset.id;
    if (state.selectedPills.has(id)) {
        state.selectedPills.delete(id);
        el.style.fill = el.dataset.originalFill;
    } else {
        state.selectedPills.add(id);
        el.style.fill = el.dataset.activeFill;
    }
    updateHubHover(el);
    updateUI();
}

function updateHubHover(el) {
    const isSelected = state.selectedPills.has(el.dataset.id);
    dom.hub.label.textContent = el.dataset.sub;
    dom.hub.value.textContent = el.dataset.label;
    dom.hub.status.textContent = isSelected ? "SCHEDULED" : "EMPTY";
    dom.hub.status.style.color = isSelected ? el.dataset.activeFill : "";
}

function clearHub() {
    dom.hub.label.textContent = "";
    dom.hub.value.textContent = "--";
    dom.hub.status.textContent = "Select";
    dom.hub.status.style.color = "";
}

function updateUI() {
    const count = state.selectedPills.size;
    if (count === 0) {
        dom.summary.text.textContent = "No pills scheduled yet.";
        dom.summary.list.innerHTML = "";
        dom.summary.clearBtn.style.display = 'none';
        dom.saveBtn.disabled = true;
    } else {
        dom.summary.text.textContent = `${count} slot${count > 1 ? 's' : ''} active.`;
        dom.summary.clearBtn.style.display = 'block';
        dom.saveBtn.disabled = false;
        generateSummaryTags();
    }
}

function generateSummaryTags() {
    dom.summary.list.innerHTML = "";
    const items = [];
    state.selectedPills.forEach(id => {
        const el = document.querySelector(`path[data-id="${id}"]`);
        if (el) items.push({ id: id, label: `${el.dataset.sub} - ${el.dataset.label}`, color: el.dataset.activeFill, sortIndex: parseInt(el.dataset.sortIndex) });
    });
    items.sort((a, b) => a.sortIndex - b.sortIndex);
    items.forEach(item => {
        const tag = document.createElement('div');
        tag.className = 'pill-tag';
        tag.innerHTML = `<span class="pill-dot" style="background:${item.color}"></span> ${item.label}`;
        dom.summary.list.appendChild(tag);
    });
}

// --- NEW FEATURES START HERE ---

// 1. Unified JSON Payload
dom.saveBtn.addEventListener('click', async () => {
    const btnText = dom.saveBtn.querySelector('.btn-text');
    const originalText = btnText.textContent;
    btnText.textContent = "Syncing...";
    dom.saveBtn.disabled = true;

    // Requirement 1: Single JSON containing both timings and pills
    const payload = {
        auth: state.device.password, // Send password/pin
        settings: state.timings,
        schedule: Array.from(state.selectedPills)
    };

    try {
        // Use the IP address set in the configuration
        const response = await fetch(`http://${state.device.ip}/save-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("Sync Successful!");
            setConnectionStatus(true);
        } else {
            throw new Error("Device rejected request");
        }
    } catch (error) {
        console.error(error);
        alert(`Sync Failed. Is the device connected at ${state.device.ip}?`);
        setConnectionStatus(false);
    } finally {
        btnText.textContent = originalText;
        dom.saveBtn.disabled = false;
    }
});

// 2. Connection Management (Heartbeat)
// This fulfills the "Newest logs updated when connection is made" requirement
function startHeartbeat() {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    
    // Check connection every 5 seconds
    state.heartbeatInterval = setInterval(checkConnection, 5000);
    checkConnection(); // Check immediately
}

async function checkConnection() {
    try {
        // The ESP32 should have a simple lightweight endpoint like /status or /ping
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
        
        const response = await fetch(`http://${state.device.ip}/status`, { 
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            if (!state.device.isConnected) {
                // Requirement 3: Auto-update logs on fresh connection
                console.log("Connection established! Fetching logs...");
                fetchLogs(); 
            }
            setConnectionStatus(true);
        } else {
            setConnectionStatus(false);
        }
    } catch (e) {
        setConnectionStatus(false);
    }
}

function setConnectionStatus(connected) {
    state.device.isConnected = connected;
    dom.indicators.wifiDot.className = connected ? 'status-dot connected' : 'status-dot error';
    dom.indicators.connMsg.textContent = connected 
        ? `Status: Connected to ${state.device.ip}` 
        : `Status: Disconnected (Unreachable)`;
    dom.indicators.connMsg.style.color = connected ? 'var(--success)' : 'var(--error)';
}

// 3. Log Retrieval & Display
async function fetchLogs() {
    // Requirement 2: Fetch logs
    dom.logs.container.innerHTML = '<div class="log-entry placeholder">Loading logs...</div>';
    
    try {
        const response = await fetch(`http://${state.device.ip}/get-logs`);
        if (!response.ok) throw new Error("Log fetch failed");
        
        const text = await response.text(); 
        // Assuming logs come as newline separated text or JSON. 
        // Let's assume JSON array for cleaner parsing, e.g., [{time: "10:00", msg: "Dispensed"}, ...]
        // OR standard text lines. Let's handle Text Lines for ESP32 simplicity.
        
        const lines = text.split('\n').filter(line => line.trim() !== "");
        renderLogs(lines);

    } catch (e) {
        dom.logs.container.innerHTML = '<div class="log-entry placeholder" style="color:var(--error)">Failed to retrieve logs. Device offline?</div>';
    }
}

function renderLogs(logLines) {
    dom.logs.container.innerHTML = "";
    
    // Reverse to show newest first? Or standard append. Let's do newest first.
    logLines.reverse().forEach(line => {
        // Simple parser assuming format "[Time] Message"
        const div = document.createElement('div');
        div.className = 'log-entry';
        
        // Very basic formatting
        div.innerHTML = `<span class="log-msg">${line}</span>`; 
        dom.logs.container.appendChild(div);
    });
}

// --- Event Listeners for New UI ---

// WiFi Modal
document.getElementById('btn-wifi').addEventListener('click', () => {
    dom.modals.wifi.style.display = 'flex';
});
document.getElementById('close-wifi').addEventListener('click', () => {
    dom.modals.wifi.style.display = 'none';
});
document.getElementById('btn-connect-device').addEventListener('click', () => {
    state.device.ip = dom.inputs.ip.value;
    state.device.password = dom.inputs.pass.value;
    dom.indicators.connMsg.textContent = "Status: Pinging...";
    dom.indicators.connMsg.style.color = "var(--text-muted)";
    checkConnection(); // Manual check
    startHeartbeat(); // Start background polling
});

// Logs Modal
document.getElementById('btn-logs').addEventListener('click', () => {
    dom.modals.logs.style.display = 'flex';
    if(state.device.isConnected) fetchLogs(); // Fetch on open
});
document.getElementById('close-logs').addEventListener('click', () => {
    dom.modals.logs.style.display = 'none';
});
dom.logs.refreshBtn.addEventListener('click', fetchLogs);

// Existing Settings Modal Listeners
document.getElementById('btn-settings').addEventListener('click', () => { dom.modals.settings.style.display = 'flex'; });
document.getElementById('close-settings').addEventListener('click', () => { dom.modals.settings.style.display = 'none'; });
document.getElementById('btn-save-settings').addEventListener('click', () => {
    state.timings = { breakfast: dom.inputs.bk.value, lunch: dom.inputs.ln.value, dinner: dom.inputs.dn.value };
    dom.modals.settings.style.display = 'none';
});

// Clear Button
dom.summary.clearBtn.addEventListener('click', () => {
    state.selectedPills.clear();
    document.querySelectorAll('.pill-section').forEach(p => p.style.fill = p.dataset.originalFill);
    updateUI();
});

// --- LOGIN EVENT LISTENER ---
document.getElementById('btn-login').addEventListener('click', () => {
    const input = document.getElementById('login-pin').value;
    const errorMsg = document.getElementById('login-error');
    
    // Check PIN (Default 1234)
    if (input === CONFIG.pin) {
        state.isAuthenticated = true;
        document.getElementById('login-overlay').style.display = 'none';
        
        // Initialize App AFTER Login
        initDB().then(async () => {
            // 1. Load existing data
            renderLogsAndAnalytics(); 

            // 2. CHECK FOR EMPTY DB & ASK FOR DUMMY DATA
            const logs = await getAllLogs();
            if (logs.length === 0) {
                // The 'confirm' stops the code until you click OK or Cancel
                const userWantsData = confirm("Welcome! No logs found. Generate dummy data for testing?");
                if (userWantsData) {
                    generateDummyData();
                }
            }
        });
    } else {
        errorMsg.textContent = "Incorrect PIN";
        document.getElementById('login-pin').value = "";
    }
});

// --- UPDATED LOG SYNC LOGIC ---

async function fetchLogs() {
    const btn = document.getElementById('btn-refresh-logs');
    btn.textContent = "Syncing...";
    
    try {
        if(!state.device.isConnected) throw new Error("Device not connected");

        const response = await fetch(`http://${state.device.ip}/get-logs`);
        if (!response.ok) throw new Error("Fetch failed");
        
        // 1. Get Raw Text (CSV format)
        const textData = await response.text();
        const lines = textData.split('\n').filter(line => line.trim() !== "");

        // 2. Parse CSV to Object
        // Expected ESP32 format: "YYYY-MM-DD HH:MM:SS,dayIndex,slotIndex,EventName"
        const newLogs = lines.map(line => {
            const parts = line.split(',');
            if(parts.length < 4) return null; // Skip bad lines
            
            // Convert "2023-11-27 20:00:00" to Timestamp
            const timeStr = parts[0].trim(); // "2023-11-27 20:00:00"
            const dateObj = new Date(timeStr.replace(' ', 'T')); // ISO format trick
            
            return {
                timestamp: Math.floor(dateObj.getTime() / 1000),
                msg: `${parts[3]} (Day ${parts[1]}, Slot ${parts[2]})`,
                type: parts[3].toLowerCase().includes("dispensed") ? "dispense" : "info"
            };
        }).filter(item => item !== null);
        
        // 3. Save to Local DB
        newLogs.forEach(log => saveLog(log));

        alert(`Synced ${newLogs.length} new entries.`);
    } catch (e) {
        console.log("Sync skipped or failed.", e);
    } finally {
        renderLogsAndAnalytics();
        btn.textContent = "Sync from ESP32";
    }
}

// --- ANALYTICS STATE ---
let analyticsState = {
    chart: null,
    currentWeekStart: new Date(), // Tracks the visible week
    allLogs: []
};

// --- DUMMY DATA GENERATOR (90 Days) ---
function generateDummyData() {
    console.log("Generating 3 months of dummy data...");
    const now = new Date();
    const oneDay = 24 * 60 * 60;
    
    // Clear existing for clean test
    // In a real app, you might check if data exists first
    
    // Generate 90 days of history
    for (let i = 0; i < 90; i++) {
        const date = new Date(now.getTime() - (i * oneDay * 1000));
        const baseTimestamp = Math.floor(date.getTime() / 1000);
        
        // We will simulate 3 meals per day
        const meals = [
            { name: "Breakfast", offset: -40000 }, // ~8 AM
            { name: "Lunch", offset: -20000 },     // ~1 PM
            { name: "Dinner", offset: 0 }          // ~8 PM
        ];

        meals.forEach(meal => {
            const rand = Math.random();
            
            // Logic: 
            // 90% Chance: Taken (Dispensed)
            // 5% Chance: Missed (User didn't respond)
            // 5% Chance: No Data (Device off/Skipped)
            
            if (rand > 0.1) {
                // TAKEN
                saveLog({
                    timestamp: baseTimestamp + meal.offset + (Math.random() * 600),
                    msg: `${meal.name} Dispensed`,
                    type: "dispense"
                });
            } else if (rand > 0.05) {
                // MISSED (Simulating a timeout log)
                saveLog({
                    timestamp: baseTimestamp + meal.offset + 3600, // Logged 1 hour later as missed
                    msg: `${meal.name} Missed`,
                    type: "missed" // Distinct type for analytics
                });
            }
        });
    }
    
    renderLogsAndAnalytics();
    alert("Generated 90 days of history with missed pills.");
}

// --- UPDATED CHART & NAVIGATION ---

// Helper: Get start of the week (Monday)
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(d.setDate(diff));
}

// Helper: Add days
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function updateChart(logs) {
    analyticsState.allLogs = logs;
    
    // Initialize view to current week if not set
    if (!analyticsState.currentWeekStart) {
        analyticsState.currentWeekStart = getMonday(new Date());
    }
    
    renderChartForWeek(analyticsState.currentWeekStart);
}

function renderChartForWeek(startDate) {
    const ctx = document.getElementById('complianceChart').getContext('2d');
    const endDate = addDays(startDate, 6);
    
    // 1. Update Label (e.g., "Nov 20 - Nov 26")
    const options = { month: 'short', day: 'numeric' };
    document.getElementById('chart-date-range').textContent = 
        `${startDate.toLocaleDateString('en-US', options)} - ${endDate.toLocaleDateString('en-US', options)}`;

    // 2. Filter Logs for this specific week
    // We compare timestamps (seconds)
    const startTs = Math.floor(startDate.setHours(0,0,0,0) / 1000);
    const endTs = Math.floor(endDate.setHours(23,59,59,999) / 1000);
    
    const weekLogs = analyticsState.allLogs.filter(l => l.timestamp >= startTs && l.timestamp <= endTs);

    // 3. Aggregate Data (Days of Week)
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const takenData = [0, 0, 0, 0, 0, 0, 0];
    const missedData = [0, 0, 0, 0, 0, 0, 0];
    
    weekLogs.forEach(log => {
        const logDate = new Date(log.timestamp * 1000);
        // getDay returns 0 for Sunday, 1 for Monday. We need 0 for Monday.
        let dayIndex = logDate.getDay() - 1; 
        if (dayIndex === -1) dayIndex = 6; // Sunday
        
        if (log.type === 'dispense') takenData[dayIndex]++;
        else if (log.type === 'missed') missedData[dayIndex]++;
    });

    // 4. Calculate Stats for this week
    const totalTaken = takenData.reduce((a, b) => a + b, 0);
    const totalMissed = missedData.reduce((a, b) => a + b, 0);
    const total = totalTaken + totalMissed;
    const adherence = total > 0 ? Math.round((totalTaken / total) * 100) : 0;

    document.getElementById('stat-adherence').textContent = `${adherence}%`;
    document.getElementById('stat-missed').textContent = totalMissed;

    // 5. Render Chart.js
    if (analyticsState.chart) analyticsState.chart.destroy();

    analyticsState.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: days,
            datasets: [
                {
                    label: 'Taken',
                    data: takenData,
                    backgroundColor: '#10b981', // Green
                    borderRadius: 4,
                    stack: 'Stack 0'
                },
                {
                    label: 'Missed',
                    data: missedData,
                    backgroundColor: '#ef4444', // Red
                    borderRadius: 4,
                    stack: 'Stack 0'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
            },
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

// --- CONTROLS LISTENERS ---
document.getElementById('chart-prev').addEventListener('click', () => {
    // Go back 7 days
    analyticsState.currentWeekStart = addDays(analyticsState.currentWeekStart, -7);
    renderChartForWeek(analyticsState.currentWeekStart);
});

document.getElementById('chart-next').addEventListener('click', () => {
    // Go forward 7 days
    analyticsState.currentWeekStart = addDays(analyticsState.currentWeekStart, 7);
    renderChartForWeek(analyticsState.currentWeekStart);
});

// IMPORTANT: Update renderLogsAndAnalytics to use the new flow
// Replace the old renderLogsAndAnalytics function with this:
async function renderLogsAndAnalytics() {
    const logs = await getAllLogs();
    
    // Sort Newest First for the List
    const listLogs = [...logs].sort((a, b) => b.timestamp - a.timestamp);

    // 1. Render List
    dom.logs.container.innerHTML = "";
    document.getElementById('log-stats').textContent = `${listLogs.length} entries`;
    
    listLogs.slice(0, 50).forEach(log => { // Limit list to 50 for performance
        const date = new Date(log.timestamp * 1000).toLocaleString();
        const div = document.createElement('div');
        div.className = 'log-entry';
        
        // Color code message based on type
        let msgColor = "#f1f5f9";
        if(log.type === 'missed') msgColor = "#ef4444";
        else if(log.type === 'dispense') msgColor = "#10b981";

        div.innerHTML = `<div class="log-time" style="font-size:0.7rem; color:#64748b">${date}</div>
                         <div class="log-msg" style="color:${msgColor}">${log.msg}</div>`;
        dom.logs.container.appendChild(div);
    });

    // 2. Render Analytics (Pass all logs, the chart function handles filtering)
    // Reset to current week whenever we refresh data
    analyticsState.currentWeekStart = getMonday(new Date()); 
    updateChart(logs);
}

// --- TAB SWITCHING ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Remove active class
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        // Toggle Views
        const tab = e.target.dataset.tab;
        if(tab === 'logs') {
            document.getElementById('view-logs').style.display = 'flex';
            document.getElementById('view-analytics').style.display = 'none';
        } else {
            document.getElementById('view-logs').style.display = 'none';
            document.getElementById('view-analytics').style.display = 'block';
            renderLogsAndAnalytics(); // Refresh chart
        }
    });
});

// Start
initDispenser();
// Initialize with default IP check
dom.inputs.ip.value = state.device.ip;
startHeartbeat();