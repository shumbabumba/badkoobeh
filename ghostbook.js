var map = L.map('map').setView([40.394622345395554, 49.84926027776045], 12);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

fetch("files/locations.json")
    .then(response => response.json())
    .then(locations => {
        for (const location of locations) {
            const textIcon = L.divIcon({
            className: 'custom-text-marker',
            html: `<div style="color: white; font-weight: bold;">${location.id}</div>`,
            iconSize: [100, 40],
            iconAnchor: [50, 20]
            });
        L.marker([location.latitude, location.longitude], {
                icon: textIcon 
            }).addTo(map);
        }
    });

    
