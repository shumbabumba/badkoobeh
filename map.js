// Create a Leaflet map with no user interaction
const map = L.map('map', {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false
}).setView([40.394622345395554, 49.84926027776045], 13);

// Add a dark basemap layer from Carto
L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_288o_1_c5f4eb7fd5cf7cf6b3f16338', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
}).addTo(map);
// Remove the default Leaflet attribution prefix
map.attributionControl.setPrefix(false);

// Define the base geographical area for weather sampling across the Absheron peninsula and Caspian coast
const weatherBounds = L.latLngBounds([40.30, 49.70], [40.52, 50.20]);
// Calculate padding in pixels based on the map container's dimensions
const mapPadding = L.point(map.getSize().x / 2, map.getSize().y * 0.85);
const zoom = map.getZoom();
// Convert weatherBounds coordinates to projected map pixels at the current zoom level
const projectedNorthWest = map.project(weatherBounds.getNorthWest(), zoom);
const projectedSouthEast = map.project(weatherBounds.getSouthEast(), zoom);
const mapDisplayBounds = L.latLngBounds(
    // Expand both projected corners by the pixel padding and convert them back to geographical coordinates
    map.unproject(projectedNorthWest.subtract(mapPadding), zoom),
    map.unproject(projectedSouthEast.add(mapPadding), zoom)
);
// Set the expanded display bounds as the map's geographical movement limits
map.setMaxBounds(mapDisplayBounds);