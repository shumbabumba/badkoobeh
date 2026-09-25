// Main app flow
Promise.all([fetchJSON('files/locations.json'), fetchJSON('files/text.json')]).then(function (results) {
    var locations = results[0];
    var text = results[1];

    if (!Array.isArray(locations) || locations.length === 0) {
        console.error('No locations found');
        return;
    }
    if (!Array.isArray(text) || text.length === 0) {
        console.error('No text fragments found');
        return;
    }

    // Random origin selection (one of the 77 locations)
    var origin = locations[Math.floor(Math.random() * locations.length)];
    console.log('Selected origin', origin);

    // Center map on origin with a comfortable zoom
    map.setView([origin.latitude, origin.longitude], 13);

    // Create text manager
    var textManager = new TextManager(map, text, { latitude: origin.latitude, longitude: origin.longitude });
    textManager.start();

    // Create weather manager and wire updates into text manager
    var weatherManager = new WeatherManager(origin.latitude, origin.longitude, function (current) {
        // current.vector is in pixels/sec already
        textManager.getWeather(current.vector, current.precipitation);
    });
    weatherManager.start();

}).catch(function (err) {
    console.error('Startup error', err);
});