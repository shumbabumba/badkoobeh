// Helper function for fetching JSON files and handling HTTP errors
function fetchJSON(path) {
    return fetch(path).then(function (r) {
        if (!r.ok) throw new Error('Failed to fetch ' + path + ': ' + r.status);
        return r.json();
    });
}

// Show the reload prompt when an Open-Meteo request fails
function showWeatherError() {
    const errorPanel = document.getElementById('weather-error');
    errorPanel.hidden = false;
    // For accessibility, move keyboard focus to the reload button
    document.getElementById('weather-error-reload').focus();
}
// Let the visitor refresh the page
document.getElementById('weather-error-reload').addEventListener('click', function () {
    window.location.reload();
});

// Load both json files at the same time before starting the experience
Promise.all([fetchJSON('files/locations.json'), fetchJSON('files/text.json')]).then(function (results) {
    const locations = results[0];
    const text = results[1];
    // Stop startup if responses are not non-empty arrays
    if (!Array.isArray(locations) || locations.length === 0) {
        console.error('No locations found');
        return;
    }
    if (!Array.isArray(text) || text.length === 0) {
        console.error('No text fragments found');
        return;
    }
    // Select one location at random to serve as current session's fixed origin
    const origin = locations[Math.floor(Math.random() * locations.length)];
    console.info('Session Origin', {
        id: origin.id,
        latitude: origin.latitude,
        longitude: origin.longitude
    });
    // Initialize weather and text manager 
    const weatherManager = new WeatherManager(worldBounds);
    const textManager = new TextManager(map, text,
        { 
            latitude: origin.latitude, 
            longitude: origin.longitude 
        },
        // Pass weather manager to text manager so it can query wind data
        { 
            weather: weatherManager 
        }
    );
    // Start the weather manager
    const weatherReady = weatherManager.start(showWeatherError);
    // Wait for the weather grid to be loaded
    weatherReady.then(function (result) {
        // Stop startup and show the error panel when the request failed
        if (!result.success) {
            console.error('Startup stopped because the weather grid could not be loaded.');
            showWeatherError();
            return;
        }
        // Retrieve current wind vector at the selected origin and timestamp
        const wind = weatherManager.getWindAt(origin.latitude, origin.longitude, Date.now());
        // Determine the strongest wind component
        const strongestWindComponent = wind
            ? Math.max(Math.abs(wind.east), Math.abs(wind.north))
            : 0;
        // Initialize the origin's screen point to the viewport center
        let originScreenPoint = L.point(map.getSize().x / 2, map.getSize().y / 2);
        // If there is a dominant wind component
        if (strongestWindComponent > 0) {
            // If north-south wind is stronger than east-west wind
            if (Math.abs(wind.north) / map.getSize().y >= Math.abs(wind.east) / map.getSize().x) {
                // Center the origin horizontally and shift it vertically in the wind direction
                originScreenPoint = L.point(
                    map.getSize().x / 2,
                    map.getSize().y * (0.5 + 0.35 * Math.sign(wind.north))
                );
            // For dominant east-west wind, center the origin vertically and horizontally
            } else {
                originScreenPoint = L.point(map.getSize().x / 2, map.getSize().y / 2);
            }
        }
        // Convert the origin from geographic coordinates to map pixels at the current zoom level
        const projectedOrigin = map.project([origin.latitude, origin.longitude], map.getZoom());
        // Calculate the viewport's center point in screen pixels
        const screenCenter = L.point(map.getSize().x / 2, map.getSize().y / 2);
        // Shift the projected map center so the origin lands at its wind-relative screen point
        const projectedCenter = L.point(
            projectedOrigin.x + screenCenter.x - originScreenPoint.x,
            projectedOrigin.y + screenCenter.y - originScreenPoint.y
        );
        // Apply the adjusted view while preserving the existing zoom level
        map.setView(map.unproject(projectedCenter, map.getZoom()), map.getZoom());
        // Start the text manager after the weather grid is loaded and the map view is adjusted
        textManager.start();
    });
// Handle any failure from loading data or initializing the app
}).catch(function (err) {
    console.error('Startup error', err);
});
