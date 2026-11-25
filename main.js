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
    const weatherManager = new WeatherManager(weatherBounds);
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
        // Determine the strongest wind component (returns number in m/s, or 0 if no wind data is available)
        const strongestWindComponent = wind
            ? Math.max(Math.abs(wind.east), Math.abs(wind.north))
            : 0;
        // Center the desired screen position of origin by default
        let originGoal = L.point(map.getSize().x / 2, map.getSize().y / 2);
        // If there is a dominant wind component
        if (strongestWindComponent > 1) {
            // If north-south wind is stronger than east-west wind
            if (Math.abs(wind.north) / map.getSize().y >= Math.abs(wind.east) / map.getSize().x) {
                // Center the origin horizontally and shift it vertically based on the wind direction
                originGoal = L.point(
                    map.getSize().x / 2.5,
                    map.getSize().y * (0.5 + 0.35 * Math.sign(wind.north))
                );
            }
        }
        // Get the map's current zoom level
        const zoom = map.getZoom();
        // Convert the origin from geographic coordinates to projected map pixels at the current zoom level
        const projectedOrigin = map.project([origin.latitude, origin.longitude], zoom);
        // Get the viewport's center point in screen pixels
        const screenCenter = L.point(map.getSize().x / 2, map.getSize().y / 2);
      // Calculate the projected map center so the origin appears at its desired screen position
        const projectedMapCenter = L.point(
            projectedOrigin.x + screenCenter.x - originGoal.x,
            projectedOrigin.y + screenCenter.y - originGoal.y
        );
        // Convert the calculated projected map center back to geographic coordinates
        const mapCenter = map.unproject(projectedMapCenter, zoom);
        // Apply the adjusted view at the current zoom level
        map.setView(mapCenter, zoom);
        // Start spawning and animating text fragments
        textManager.start();
    });
// Handle any failure from loading data or initializing the app
}).catch(function (err) {
    console.error('Startup error', err);
});
