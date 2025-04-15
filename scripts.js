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

        // Process data in reverse to maintain chronological order
        for (let i = json.length - 1; i >= 0; i--) {
            const dataPoint = json[i];
            const timestamp = new Date(dataPoint.timestamp).toLocaleTimeString();

            // Update charts with historical data
            updateChartData(dataPoint, timestamp, batteryPercentage);
        }
    } catch (error) {
        console.error(error.message);
    }
}

// ======================
// Dashboard Update
// ======================

let lastIbatUpdateTime = Date.now(); // Keep track of the last time Ibat was updated

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
}


// ======================
// Pollen Chart Initialization
// ======================

const pollenCtx = document.getElementById('pollenChart').getContext('2d');
const pollenChart = new Chart(pollenCtx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Pollen',
                data: [],
                borderColor: 'rgba(255, 165, 0, 1)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-value',
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
                    font: { size: 14 }, color: 'rgba(255, 255, 255, 0.8)',
                },
            },
        },
        scales: {
            x: {
                title: { display: true, text: 'Time', color: '#ffffff' },
                ticks: { color: '#ffffff' },
            },
            'y-value': {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Value',
                    color: '#ffffff',
                    font: { size: 14 }
                },
                ticks: {
                    color: '#ffffff',
                    font: { size: 12 }
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)' // Optional: softer gridlines
                }
            }
        }
    },
});

// ======================
// Sensor Chart Initialization
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
                borderColor: 'rgb(51, 255, 129)',
                borderWidth: 2,
                fill: false,
                yAxisID: 'y-temp',
            },
            {
                label: 'Box Humidity (%)',
                data: [],
                borderColor: 'rgb(107, 85, 255)',
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
// Chart Data Update
// ======================

function updateChartData(data, timestamp, batteryPercentage) {
    const now = timestamp ?? new Date().toLocaleTimeString();

    // Update Pollen Chart
    if (data.power) {
        pollenChart.data.labels.push(now);
        // pollenChart.data.datasets[0].data.push(data.power.pollen ?? null);

        if (pollenChart.data.labels.length > 100) {
            pollenChart.data.labels.shift();
            pollenChart.data.datasets.forEach(dataset => dataset.data.shift());
        }
        pollenChart.update();
    }
}

function pollLocalDHT22() {
    fetch("http://pollen3.local:8080/api/get_dht")
        .then((res) => res.json())
        .then((data) => {
            const temperature = data.temperature ?? null;
            const humidity = data.humidity ?? null;

            if (temperature !== null) {
                document.getElementById('temp1').textContent = temperature.toFixed(1);
            }
            if (humidity !== null) {
                document.getElementById('humidity1').textContent = humidity.toFixed(1);
            }

            const now = new Date().toLocaleTimeString();
            sensorChart.data.labels.push(now);
            sensorChart.data.datasets[0].data.push(temperature);
            sensorChart.data.datasets[1].data.push(humidity);

            if (sensorChart.data.labels.length > 100) {
                sensorChart.data.labels.shift();
                sensorChart.data.datasets.forEach((dataset) => dataset.data.shift());
            }

            sensorChart.update();
        })
        .catch((err) => {
            console.warn("Failed to fetch DHT22 data:", err);
        });
}

// Poll every 15 seconds
setInterval(pollLocalDHT22, 15000);
pollLocalDHT22(); // Initial fetch on load

// ======================
// Export to CSV
// ======================

function exportPollenData() {
    const csvRows = [];
    const headers = ['Time', 'Pollen Count'];
    csvRows.push(headers.join(','));

    pollenChart.data.labels.forEach((label, i) => {
        const pollenValue = pollenChart.data.datasets[0].data[i];
        const row = [
            label,
            pollenValue !== undefined ? pollenValue.toFixed(2) : ''
        ];
        csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pollen_data.csv';
    link.click();
}

function exportSensorData() {
    const csvRows = [];
    const headers = ['Time', 'Box Temperature (°C)', 'Box Humidity (%)'];
    csvRows.push(headers.join(','));

    sensorChart.data.labels.forEach((label, i) => {
        const row = [
            label,
            sensorChart.data.datasets[0].data[i] || '',
            sensorChart.data.datasets[1].data[i] || '',
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
        } else if (chartContainerId === 'pollenChartContainer' && pollenChart) {
            pollenChart.resize();
        }
    } else {
        console.error(`Chart container with id "${chartContainerId}" not found.`);
    }
}

// ======================
// Attach Events to Buttons
// ======================

// Export toggle button handlers
document.getElementById('exportDataButton').addEventListener('click', exportSensorData);
document.getElementById('exportPollenDataButton').addEventListener('click', exportPollenData);

// Toggle button handlers
document.getElementById('toggleSensorChart').addEventListener('click', () => toggleChartWithResize('sensorChartContainer'));
document.getElementById('togglePollenChart').addEventListener('click', () => toggleChartWithResize('pollenChartContainer'));