// Helper function to fetch JSON and handle errors
function fetchJSON(path) {
    return fetch(path).then(function (r) {
        if (!r.ok) throw new Error('Failed to fetch ' + path + ': ' + r.status);
        return r.json();
    });
}

// Main app flow 
Promise.all([fetchJSON('files/locations.json'), fetchJSON('files/text.json')]).then(function (results) {
    const locations = results[0];
    const text = results[1];

    if (!Array.isArray(locations) || locations.length === 0) {
        console.error('No locations found');
        return;
    }
    if (!Array.isArray(text) || text.length === 0) {
        console.error('No text fragments found');
        return;
    }

    // Random origin selection (one of the 77 locations)
    const origin = locations[Math.floor(Math.random() * locations.length)];
    console.log('Selected origin', origin);

    // Center map on origin with a comfortable zoom
    map.setView([origin.latitude, origin.longitude], 13);

    // Create text manager
    const textManager = new TextManager(map, text, { latitude: origin.latitude, longitude: origin.longitude });
    textManager.start();

    // Create weather manager and wire updates into text manager
    const weatherManager = new WeatherManager(origin.latitude, origin.longitude, function (current) {
        // current.vector is in pixels/sec already
        textManager.getWeather(current.vector, current.precipitation);
    });
    weatherManager.start();

}).catch(function (err) {
    console.error('Startup error', err);
});