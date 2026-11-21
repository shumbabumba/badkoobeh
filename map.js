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
map.attributionControl.setPrefix(false);

// Define the weather grid coverage across the Absheron peninsula and Caspian coast
const worldBounds = L.latLngBounds([40.30, 49.70], [40.52, 50.20]);
// Allow the map to be panned beyond weather grid coverage by a padding factor
const mapPadding = L.point(map.getSize().x / 2, map.getSize().y * 0.85);
const projectedNorthWest = map.project(worldBounds.getNorthWest(), map.getZoom());
const projectedSouthEast = map.project(worldBounds.getSouthEast(), map.getZoom());
const mapDisplayBounds = L.latLngBounds(
    // Pan the map further to the northwest
    map.unproject(projectedNorthWest.subtract(mapPadding), map.getZoom()),
    // Pan the map further to the southeast
    map.unproject(projectedSouthEast.add(mapPadding), map.getZoom())
);
map.setMaxBounds(mapDisplayBounds);
