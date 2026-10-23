// Define a helper for downloading a file and reading its response as JSON
function fetchJSON(path) {
    return fetch(path).then(function (r) {
        // Check whether the server returned a successful HTTP status code
        if (!r.ok) throw new Error('Failed to fetch ' + path + ': ' + r.status);
        // Parse the response body as JSON and return the resulting promise
        return r.json();
    });
}

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

    // Center the map on the selected origin and set its initial zoom level to 13
    map.setView([origin.latitude, origin.longitude], 13);

    // Create one shared weather manager for the full map territory and session.
    const weatherManager = new WeatherManager(worldBounds);
    // Create the fragment manager with the map, book text, fixed origin, and weather source.
    const textManager = new TextManager(
        // Pass the map so fragments can be positioned and projected geographically.
        map,
        // Pass the array of book text fragments to display.
        text,
        // Pass the selected origin's coordinates as the spawn point for all fragments.
        { latitude: origin.latitude, longitude: origin.longitude },
        // Pass the shared weather manager as an option to the fragment manager.
        { weather: weatherManager }
    // Finish the TextManager constructor call.
    );

    // Begin loading and periodically refreshing the shared weather grid.
    weatherManager.start();
    // Begin spawning and animating text fragments on the map.
    textManager.start();

// Handle any failure from loading data or initializing the app.
}).catch(function (err) {
    // Print the startup failure to the browser console for debugging.
    console.error('Startup error', err);
// Finish the error callback and Promise chain.
});
