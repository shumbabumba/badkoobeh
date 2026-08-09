var map = L.map('map').setView([40.394622345395554, 49.84926027776045], 12);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

fetch("files/locations.json")
    .then(response => response.json())
    .then(locations => {
        for (const location of locations) {
            const marker = L.marker([location.latitude, location.longitude]).addTo(map);
            let popup = `
                <b>${location.title}</b><br>
                Date: ${location.date}<br>
                `;

            for(let i = 0; i < location.imageCount; i++)
            {
                popup += `
                <img src="images/${location.id}_${i}.jpg">`;
            }

            marker.bindPopup(popup);
        }
    });
