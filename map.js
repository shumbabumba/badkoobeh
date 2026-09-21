// Create a Leaflet map with no user interaction
var map = L.map('map', {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false
}).setView([40.394622345395554, 49.84926027776045], 12);

// Add a dark basemap layer from Carto
L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_288o_1_c5f4eb7fd5cf7cf6b3f16338', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
}).addTo(map);
map.attributionControl.setPrefix(false);

// Constrain the visible area to the Absheron peninsula + Caspian coastal region
var worldBounds = L.latLngBounds([40.30, 49.70], [40.52, 50.20]);
map.setMaxBounds(worldBounds);

