// ======================
// Map Initialization
// ======================
const map = L.map('map').setView([0, 0], 13);
const marker = L.marker([0, 0]).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
}).addTo(map);

// ======================
// GPS Setup
// ======================
const gps = new GPS();
let satellitesConnected = 0; // Track connected satellites

// ======================
// MQTT Client Setup
// ======================
const brokerURL = "wss://mqtt.eclipseprojects.io/mqtt";
const topic = "/pollen";
const client = mqtt.connect(brokerURL);

client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe(topic, (err) => {
        if (err) {
            console.error("Failed to subscribe to topic:", err);
        } else {
            console.log(`Subscribed to topic: ${topic}`);
        }
    });

    loadData();
});

client.on("message", (topic, message) => {
    const data = JSON.parse(message.toString());
    console.log(`Received data:`, data);

    // Update `lastIbatUpdateTime` if new data contains `Ibat`
    if (data.power?.Ibat) {
        lastIbatUpdateTime = Date.now(); // Update the timestamp
    }

    const timestamp = new Date().toLocaleTimeString();
    updateDashboard(data);
    updateChartData(data, timestamp);
});

// ======================
// Load Stored Data
// ======================
const apiUrl = "https://pollen.botondhorvath.com/api"

async function getDevice() {
    const response = await fetch(`${apiUrl}/devices`)
    if (!response.ok) {
        throw new Error(`Response status: ${response.status}`)
    }

    const json = await response.json()

    return json[0]
}

async function getHistory() {
    const response = await fetch(`${apiUrl}/history`)
    if (!response.ok) {
        throw new Error(`Response status: ${response.status}`)
    }

    return await response.json()
}

async function loadData() {
    try {
        const device = await getDevice();
        // Update dashboard with the latest data point
        updateDashboard(device);
    } catch (error) {
        console.error(error.message);
    }

    try {
        const json = await getHistory();

        if (!json || json.length === 0) {
            return;
        }

        let lastBatteryPercentage = null; // Track the last known battery percentage

        // Process data in reverse to maintain chronological order
        for (let i = json.length - 1; i >= 0; i--) {
            const dataPoint = json[i];
            const timestamp = new Date(dataPoint.timestamp).toLocaleTimeString();

            // Calculate battery percentage if available
            const batteryPercentage = dataPoint.power
                ? Math.max(0, Math.min(100, ((dataPoint.power.Vbat / 1000 - 3) / (4.2 - 3)) * 100)).toFixed(2)
                : lastBatteryPercentage; // Use last known if not available

            // Update charts with historical data
            updateChartData(dataPoint, timestamp, batteryPercentage);

            // Update last known battery percentage
            if (!isNaN(batteryPercentage)) {
                lastBatteryPercentage = batteryPercentage;
            }
        }
    } catch (error) {
        console.error(error.message);
    }
}

// ======================
// Dashboard Update
// ======================
let lastIbatUpdateTime = Date.now(); // Keep track of the last time Ibat was updated
let Ibat = 0; // Default Ibat value (in mAh)
const DEFAULT_SLEEP_POWER_USAGE = -2800; // in mAh (adjusted for consistency)
const TIMEOUT_PERIOD = 10000; // 10 seconds in milliseconds

function updateDashboard(data) {
    // Update timestamp
    let timestampText = "";
    const timestampDate = data.timestamp ? new Date(data.timestamp) : new Date();
    if (timestampDate.valueOf() + 86400000 < new Date().valueOf()) {
        timestampText = timestampDate.toLocaleDateString();
        timestampText += " ";
    }
    timestampText += timestampDate.toLocaleTimeString();
    document.getElementById('dataTimestamp').textContent = timestampText;

    // Update sensor data
    if (data.dht22) {
        document.getElementById('temp1').textContent = data.dht22[0]?.t?.toFixed(1) || '--'; 
        document.getElementById('humidity1').textContent = data.dht22[0]?.rh?.toFixed(1) || '--';
        document.getElementById('temp2').textContent = data.dht22[1]?.t?.toFixed(1) || '--'; 
        document.getElementById('humidity2').textContent = data.dht22[1]?.rh?.toFixed(1) || '--'; 
    }

    // Update GPS data
    if (data.gps) {
        const gpsString = data.gps;
        const gpsLines = gpsString.split("\n");
        let latitude = null,
            longitude = null,
            altitude = null,
            satellitesConnected = null,
            speed = null;

        gpsLines.forEach((line) => {
            const parts = line.split(",");
            if (parts[0] === "$GPRMC") {
                // Extract latitude, longitude, and speed
                const rawLatitude = parseFloat(parts[3]);
                const rawLongitude = parseFloat(parts[5]);

                // Convert from NMEA format (degrees and minutes) to decimal degrees
                const latDegrees = Math.floor(rawLatitude / 100);
                const latMinutes = rawLatitude % 100;
                latitude = latDegrees + latMinutes / 60;

                const lonDegrees = Math.floor(rawLongitude / 100);
                const lonMinutes = rawLongitude % 100;
                longitude = lonDegrees + lonMinutes / 60;

                // Adjust for N/S and E/W
                if (parts[4] === "S") latitude *= -1;
                if (parts[6] === "W") longitude *= -1;

                speed = parseFloat(parts[7]) * 1.852; // Convert knots to km/h
            } else if (parts[0] === "$GPGGA") {
                // Extract altitude and satellites connected
                altitude = parseFloat(parts[9]);
                satellitesConnected = parseInt(parts[7], 10);
            }
        });

        // Update DOM elements for GPS
        document.getElementById('latitude').textContent = latitude ? latitude.toFixed(6) : '--';
        document.getElementById('longitude').textContent = longitude ? longitude.toFixed(6) : '--';
        document.getElementById('altitude').textContent = altitude !== null ? altitude.toFixed(1) : '--';
        document.getElementById('speed').textContent = speed !== null ? speed.toFixed(1) : '--';
        document.getElementById('satellites-connected').textContent = satellitesConnected !== null ? satellitesConnected : '--';

        // Update the map marker
        if (latitude && longitude) {
            marker.setLatLng([latitude, longitude]);
            map.setView([latitude, longitude], 13);
        }
    }

     // Update power data
     if (data.power) {
        const Vsol = (data.power.Vsol / 1000).toFixed(2); // Convert mV to V
        const Vbat = (data.power.Vbat / 1000).toFixed(2); // Convert mV to V
        const Isol = data.power.Isol.toFixed(0); // Solar current in mA
        Ibat = data.power.Ibat; // Current in mA

        // Calculate battery percentage first
        const batteryPercentage = Math.max(
            0,
            Math.min(100, ((Vbat - 3) / (4.2 - 3)) * 100)
        ).toFixed(2);

        document.getElementById('vsol').textContent = Vsol || '--';
        document.getElementById('vbat').textContent = Vbat || '--';
        document.getElementById('isol').textContent = Isol || '--'; // Update solar current
        document.getElementById('ibat').textContent = `${Ibat.toFixed(0)}`;
        document.getElementById('battery-percentage').textContent = `${batteryPercentage}`; // Update battery percentage

        // Update Is Charging and PGood
        const isChargingElement = document.getElementById('isCharging');
        const pgoodElement = document.getElementById('pgood');

        if (data.power.is_charging) {
            isChargingElement.textContent = '🟢'; // Green for true
        } else {
            isChargingElement.textContent = '🔴'; // Red for false
        }

        if (data.power.pgood) {
            pgoodElement.textContent = '🟢'; // Green for true
        } else {
            pgoodElement.textContent = '🔴'; // Red for false
        }

        // Handle positive Ibat (charging state)
        if (Ibat > 0) {
            document.getElementById('time-left').textContent = "Indefinitely"; // Display "indefinitely"
        } else {
            calculateTimeLeft(Vbat, Ibat, false); // Perform regular calculation for negative Ibat
        }

        // Pass battery percentage to the chart update
        // updateChartData(data, new Date().toLocaleTimeString(), batteryPercentage);
    }
}

// ======================
// Calculate Time Left
// ======================
function calculateTimeLeft(Vbat, Ibat, isFake = false) {
    const batteryCapacity = 1800; // Battery capacity in mAh (single cell)
    const minVoltage = 3.0; // Minimum voltage (single cell)
    const maxVoltage = 4.2; // Maximum voltage (single cell)

    // Calculate battery percentage
    const batteryPercentage = Math.max(
        0,
        Math.min(100, ((Vbat - minVoltage) / (maxVoltage - minVoltage)) * 100)
    ).toFixed(0);

    // Skip time calculation if Ibat is positive
    if (Ibat > 0) {
        console.log("Battery is charging, time left is indefinite.");
        document.getElementById("battery-percentage").textContent = batteryPercentage || "--";
        document.getElementById("time-left").textContent = "Indefinitely";
        return;
    }

    // Calculate remaining capacity in mAh
    const remainingCapacity = (batteryPercentage / 100) * batteryCapacity;

    let timeLeft = "--";

    if (isFake) {
        const adjustedIbat = Math.abs(Ibat) * 1000; // Convert to proper scale for fake Ibat
        if (adjustedIbat > 0) {
            const hoursLeft = ((remainingCapacity / adjustedIbat) * 1000000).toFixed(2); // Hours
            const daysLeft = (hoursLeft / 24).toFixed(1); // Days
            timeLeft = `${hoursLeft} hours (${daysLeft} days)`;
        }
    } else {
        const adjustedIbat = Math.abs(Ibat) / 1000; // Convert mA to Ah for real Ibat
        if (adjustedIbat > 0) {
            const hoursLeft = ((remainingCapacity / adjustedIbat) / 1000).toFixed(2); // Hours
            const daysLeft = (hoursLeft / 24).toFixed(1); // Days
            timeLeft = `${hoursLeft} hours (${daysLeft} days)`;
        }
    }

    if (timeLeft === "--") {
        console.warn("Ibat too small or invalid for calculation.");
        timeLeft = "Insufficient Current";
    }

    // Update DOM for time left
    document.getElementById("battery-percentage").textContent = batteryPercentage || "--";
    document.getElementById("time-left").textContent = timeLeft;

    console.log(`Time Left: ${timeLeft}`);
}

// ======================
// Timeout Logic
// ======================
setInterval(() => {
    const timeSinceLastUpdate = Date.now() - lastIbatUpdateTime;

    if (timeSinceLastUpdate > TIMEOUT_PERIOD && Ibat <= 0) { // Only fallback if Ibat is negative or missing
        // Use default value in mAh
        Ibat = DEFAULT_SLEEP_POWER_USAGE; 
        console.log("No recent Ibat data, using default sleep mode value.");

        // Display the fallback Ibat
        const displayIbat = (Ibat / 1000).toFixed(2); // Convert to Ah for display
        document.getElementById("ibat").textContent = `${displayIbat}`;

        // Perform calculations with fake Ibat
        const Vbat = parseFloat(document.getElementById("vbat").textContent) || 3.96; // Fallback voltage
        calculateTimeLeft(Vbat, Ibat, true); // Pass true for isFake
    }
}, 1000); // Check every second

// ======================
// Senosr Chart Initialization
// ======================
const ctx = document.getElementById('sensorChart').getContext('2d');
const sensorChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Box Temperature (°C)',
                data: [],
                borderColor: 'rgba(86, 204, 242, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-temp',
            },
            {
                label: 'Box Humidity (%)',
                data: [],
                borderColor: 'rgba(242, 204, 86, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-humidity',
            },
            {
                label: 'Outside Temperature (°C)',
                data: [],
                borderColor: 'rgba(86, 255, 86, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-temp',
            },
            {
                label: 'Outside Humidity (%)',
                data: [],
                borderColor: 'rgba(204, 86, 242, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-humidity',
            },
        ],
    },
    options: {
        responsive: true,
        plugins: {
            tooltip: {
                enabled: true,
                mode: 'nearest',
                intersect: false,
            },
            legend: {
                position: 'top',
                labels: { font: { size: 14 }, color: 'rgba(255, 255, 255, 0.8)' },
            },
        },
        scales: {
            x: {
                title: { display: true, text: 'Time', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
            'y-temp': {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Temperature (°C)', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
            'y-humidity': {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Humidity (%)', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
        },
    },
});

// ======================
// Power Chart Initialization
// ======================
const powerCtx = document.getElementById('powerChart').getContext('2d');
const powerChart = new Chart(powerCtx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Solar Voltage (V)',
                data: [],
                borderColor: 'rgba(255, 165, 0, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-voltage',
            },
            {
                label: 'Solar Current (mA)',
                data: [],
                borderColor: 'rgba(75, 0, 130, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-current',
            },
            {
                label: 'Battery Voltage (V)',
                data: [],
                borderColor: 'rgba(255, 69, 0, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-voltage',
            },
            {
                label: 'Battery Current (mA)',
                data: [],
                borderColor: 'rgba(148, 0, 211, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-current',
            },
        ],
    },
    options: {
        responsive: true,
        plugins: {
            tooltip: {
                enabled: true,
                mode: 'nearest',
                intersect: false,
            },
            legend: {
                position: 'top',
                labels: {
                    font: { size: 14 },
                    color: 'rgba(255, 255, 255, 0.8)',
                },
            },
        },
        scales: {
            x: {
                title: { display: true, text: 'Time', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
            'y-voltage': {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Voltage (V)', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
            'y-current': {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Current (mA)', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
        },
    },
});

// ======================
// Battery Chart Initialization
// ======================
const batteryCtx = document.getElementById('batteryChart').getContext('2d');
const batteryChart = new Chart(batteryCtx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Battery Percentage (%)',
                data: [],
                borderColor: 'rgba(50, 205, 50, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-percentage',
            },
            {
                label: 'Is Charging (1 = Yes, 0 = No)',
                data: [],
                borderColor: 'rgba(86, 204, 242, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-binary',
            },
            {
                label: 'PGood (1 = Yes, 0 = No)',
                data: [],
                borderColor: 'rgba(255, 215, 0, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-binary',
            },
        ],
    },
    options: {
        responsive: true,
        plugins: {
            tooltip: {
                enabled: true,
                mode: 'nearest',
                intersect: false,
            },
            legend: {
                position: 'top',
                labels: {
                    font: { size: 14 },
                    color: 'rgba(255, 255, 255, 0.8)',
                },
            },
        },
        scales: {
            x: {
                title: { display: true, text: 'Time', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
            'y-percentage': {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Percentage (%)', color: '#ffffff' },
                ticks: { color: '#ffffff' },
                min: 0,
                max: 100,
            },
            'y-binary': {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Binary Indicators', color: '#ffffff' },
                ticks: { color: '#ffffff', stepSize: 1 },
                min: 0,
                max: 1,
            },
        },
    },
});

// ======================
// Chart Data Update
// ======================
function updateChartData(data, timestamp, batteryPercentage) {
    const now = timestamp ?? new Date().toLocaleTimeString();

    // Update Sensor Chart
    if (data.dht22) {
        const boxTemp = data.dht22[0]?.t ?? null;
        const boxHumidity = data.dht22[0]?.rh ?? null;
        const outsideTemp = data.dht22[1]?.t ?? null;
        const outsideHumidity = data.dht22[1]?.rh ?? null;

        console.log("Sensor Data for Chart:", { boxTemp, boxHumidity, outsideTemp, outsideHumidity });

        // Push data into the chart
        sensorChart.data.labels.push(now);
        sensorChart.data.datasets[0].data.push(boxTemp);
        sensorChart.data.datasets[1].data.push(boxHumidity);
        sensorChart.data.datasets[2].data.push(outsideTemp);
        sensorChart.data.datasets[3].data.push(outsideHumidity);

        // Maintain chart data limit
        if (sensorChart.data.labels.length > 100) {
            sensorChart.data.labels.shift(); // Remove oldest label
            sensorChart.data.datasets.forEach(dataset => dataset.data.shift()); // Remove corresponding data
        }

        sensorChart.update(); // Refresh the chart
    }

    // Update Power Chart
    if (data.power) {
        powerChart.data.labels.push(now);
        powerChart.data.datasets[0].data.push(data.power.Vsol / 1000);
        powerChart.data.datasets[1].data.push(data.power.Isol);
        powerChart.data.datasets[2].data.push(data.power.Vbat / 1000);
        powerChart.data.datasets[3].data.push(data.power.Ibat);

        if (powerChart.data.labels.length > 100) {
            powerChart.data.labels.shift();
            powerChart.data.datasets.forEach(dataset => dataset.data.shift());
        }

        powerChart.update();
    }

    // Update Battery Chart
    if (data.power) {
        let finalBatteryPercentage;

        // Use provided battery percentage if valid
        if (!isNaN(batteryPercentage)) {
            finalBatteryPercentage = parseFloat(batteryPercentage); // Convert to float
        } else {
            // Retrieve the last known battery percentage from the graph
            finalBatteryPercentage =
                batteryChart.data.datasets[0].data.length > 0
                    ? batteryChart.data.datasets[0].data[batteryChart.data.datasets[0].data.length - 1]
                    : null; // Use null if no previous data exists
        }

        batteryChart.data.labels.push(now);
        batteryChart.data.datasets[0].data.push(finalBatteryPercentage);

        // Update other datasets
        const isCharging = data.power.is_charging ? 1 : 0; // Binary value
        const pgood = data.power.pgood ? 1 : 0; // Binary value

        batteryChart.data.datasets[1].data.push(isCharging);
        batteryChart.data.datasets[2].data.push(pgood);

        // Maintain chart data limit (optional: e.g., 100 points)
        if (batteryChart.data.labels.length > 100) {
            batteryChart.data.labels.shift(); // Remove oldest label
            batteryChart.data.datasets.forEach((dataset) => dataset.data.shift()); // Remove corresponding data
        }

        // Update the chart
        batteryChart.update();
    }
}
// ======================
// Export to CSV
// ======================
function exportSensorData() {
    const csvRows = [];
    const headers = ['Time', 'Box Temperature (°C)', 'Box Humidity (%)', 'Outside Temperature (°C)', 'Outside Humidity (%)'];
    csvRows.push(headers.join(','));

    sensorChart.data.labels.forEach((label, i) => {
        const row = [
            label,
            sensorChart.data.datasets[0].data[i] || '',
            sensorChart.data.datasets[1].data[i] || '',
            sensorChart.data.datasets[2].data[i] || '',
            sensorChart.data.datasets[3].data[i] || '',
        ];
        csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sensor_data.csv';
    link.click();
}

function exportPowerData() {
    const csvRows = [];
    const headers = ['Time', 'Solar Voltage (V)', 'Solar Current (mA)', 'Battery Voltage (V)', 'Battery Current (mA)', 'Battery Percentage (%)', 'Is Charging', 'PGood'];
    csvRows.push(headers.join(','));

    powerChart.data.labels.forEach((label, i) => {
        const row = [
            label,
            powerChart.data.datasets[0].data[i]?.toFixed(2) || '',
            powerChart.data.datasets[1].data[i]?.toFixed(0) || '',
            powerChart.data.datasets[2].data[i]?.toFixed(2) || '',
            powerChart.data.datasets[3].data[i]?.toFixed(0) || '',
            batteryChart.data.datasets[0].data[i]?.toFixed(0) || '',
            batteryChart.data.datasets[1].data[i],
            batteryChart.data.datasets[2].data[i],
        ];
        csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'power_data.csv';
    link.click();
}

function exportBatteryData() {
    const csvRows = [];
    const headers = ['Time', 'Battery Percentage (%)', 'Is Charging', 'PGood'];
    csvRows.push(headers.join(',')); // Add header row

    // Loop through chart data to generate CSV rows
    batteryChart.data.labels.forEach((label, i) => {
        const row = [
            label,
            batteryChart.data.datasets[0].data[i]?.toFixed(0) || '--', // Battery Percentage
            batteryChart.data.datasets[1].data[i] || '0', // Is Charging (1/0)
            batteryChart.data.datasets[2].data[i] || '0', // PGood (1/0)
        ];
        csvRows.push(row.join(',')); // Add row to CSV
    });

    // Create and download the CSV file
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'battery_data.csv';
    link.click();
}

// ======================
// Toggle Chart Visibility
// ======================
function toggleChart(chartContainerId) {
    const chartContainer = document.getElementById(chartContainerId);
    if (chartContainer) {
        // Toggle visibility
        if (chartContainer.style.display === 'none') {
            chartContainer.style.display = 'block';
        } else {
            chartContainer.style.display = 'none';
        }
    } else {
        console.error(`Chart container with id "${chartContainerId}" not found.`);
    }
}

function toggleChartWithResize(chartContainerId) {
    const chartContainer = document.getElementById(chartContainerId);
    if (chartContainer) {
        if (chartContainer.style.display === 'none') {
            chartContainer.style.display = 'block';
        } else {
            chartContainer.style.display = 'none';
        }

        // Resize the chart after toggling visibility
        if (chartContainerId === 'sensorChartContainer' && sensorChart) {
            sensorChart.resize();
        } else if (chartContainerId === 'powerChartContainer' && powerChart) {
            powerChart.resize();
        } else if (chartContainerId === 'batteryChartContainer' && batteryChart) {
            batteryChart.resize();
        }
    } else {
        console.error(`Chart container with id "${chartContainerId}" not found.`);
    }
}

// ======================
// Attach Events to Buttons
// ======================
document.getElementById('exportDataButton').addEventListener('click', exportSensorData);
document.getElementById('exportPowerDataButton').addEventListener('click', exportPowerData);
document.getElementById('exportBatteryDataButton').addEventListener('click', exportBatteryData);

// Add toggle button handlers
document.getElementById('toggleSensorChart').addEventListener('click', () => toggleChartWithResize('sensorChartContainer'));
document.getElementById('togglePowerChart').addEventListener('click', () => toggleChartWithResize('powerChartContainer'));
document.getElementById('toggleBatteryChart').addEventListener('click', () => toggleChartWithResize('batteryChartContainer'));