var map = L.map('map', { zoomControl: false,     
    attributionControl: false
}).setView([40.394622345395554, 49.84926027776045], 12);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
}).addTo(map);


    
