var map = L.map('map', { zoomControl: false     
}).setView([40.394622345395554, 49.84926027776045], 12);

L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_288o_1_c5f4eb7fd5cf7cf6b3f16338', {
    maxZoom: 20,
     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
}).addTo(map);
map.attributionControl.setPrefix(false);

title = getParameterByName('title');





    
