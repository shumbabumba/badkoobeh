// Define a helper for downloading a file and reading its response as JSON
function fetchJSON(path) {
    return fetch(path).then(function (r) {
        // Check whether the server returned a successful HTTP status code
        if (!r.ok) throw new Error('Failed to fetch ' + path + ': ' + r.status);
        // Parse the response body as JSON and return the resulting promise
        return r.json();
    });
}

// Show the reload prompt when an Open-Meteo request fails.
function showWeatherError() {
    const errorPanel = document.getElementById('weather-error');
    errorPanel.hidden = false;
    document.getElementById('weather-error-reload').focus();
}

// Let the visitor retry the experience by refreshing the page.
document.getElementById('weather-error-reload').addEventListener('click', function () {
    window.location.reload();
});

// Load both json files at the same time before starting the experience
Promise.all([fetchJSON('files/locations.json'), fetchJSON('files/text.json')]).then(function (results) {
    // Store physical locations
    const locations = results[0];
    // Store book fragments
    const text = results[1];

    // Stop startup if the locations response is not a non-empty array
    if (!Array.isArray(locations) || locations.length === 0) {
        console.error('No locations found');
        return;
    }
    // Stop startup if the text response is not a non-empty array
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

    const weatherManager = new WeatherManager(worldBounds);
    const textManager = new TextManager(map, text,
        { 
            latitude: origin.latitude, 
            longitude: origin.longitude 
        },
        { 
            weather: weatherManager 
        }
    );

    /// REVIEW FROM HERE LATER
    // Start weather updates and wait for the initial grid before positioning the map.
    const weatherReady = weatherManager.start(showWeatherError);
    // Wait for the first grid before choosing the origin's wind-relative screen position.
    weatherReady.then(function (result) {
        // Stop startup when the initial weather-grid request failed.
        if (!result.success) {
            console.error('Startup stopped because the initial weather grid could not be loaded.');
            showWeatherError();
            return;
        }
        // Keep the current initial map zoom when adjusting its center.
        const zoom = 13;
        // Look up the current wind vector at the selected geographic origin.
        const wind = weatherManager.getWindAt(origin.latitude, origin.longitude, Date.now());
        // Read the map viewport dimensions in screen pixels.
        const mapSize = map.getSize();
        // Find the strongest component so the origin can be placed near the upwind edge.
        const strongestWindComponent = wind
            ? Math.max(Math.abs(wind.east), Math.abs(wind.north))
            : 0;
        // Default to the viewport center when wind data is missing or calm.
        let originScreenPoint = L.point(mapSize.x / 2, mapSize.y / 2);
        // Place the origin on the upwind edge and center it along the other screen axis.
        if (strongestWindComponent > 0) {
            // Compare wind components against viewport dimensions to find the upwind edge reached first.
            if (Math.abs(wind.north) / mapSize.y >= Math.abs(wind.east) / mapSize.x) {
                // Center the origin horizontally on the upwind vertical edge.
                originScreenPoint = L.point(
                    mapSize.x / 2,
                    mapSize.y * (0.5 + 0.35 * Math.sign(wind.north))
                );
            // For dominant east-west wind, center the origin vertically and horizontally.
            } else {
                originScreenPoint = L.point(mapSize.x / 2, mapSize.y / 2);
            }
        }
        // Project the origin into map pixels at the zoom used for the initial view.
        const projectedOrigin = map.project([origin.latitude, origin.longitude], zoom);
        // Calculate the viewport's center point in screen pixels.
        const screenCenter = L.point(mapSize.x / 2, mapSize.y / 2);
        // Shift the projected map center so the origin lands at its wind-relative screen point.
        const projectedCenter = L.point(
            projectedOrigin.x + screenCenter.x - originScreenPoint.x,
            projectedOrigin.y + screenCenter.y - originScreenPoint.y
        );
        // Apply the adjusted view while preserving the existing zoom level.
        map.setView(map.unproject(projectedCenter, zoom), zoom);
        // Start fragment spawning only after their map coordinates match the adjusted view.
        textManager.start();
    });

// Handle any failure from loading data or initializing the app.
}).catch(function (err) {
    // Print the startup failure to the browser console for debugging.
    console.error('Startup error', err);
});
