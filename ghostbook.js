// Map initialization (preserve existing tileset)
var map = L.map('map', {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false
}).setView([40.394622345395554, 49.84926027776045], 12);

L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_288o_1_c5f4eb7fd5cf7cf6b3f16338', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
}).addTo(map);
map.attributionControl.setPrefix(false);

// Constrain the visible area to the Absheron peninsula + Caspian coastal region
// These bounds can be adjusted later if you prefer different limits
var worldBounds = L.latLngBounds([40.30, 49.70], [40.52, 50.20]);
map.setMaxBounds(worldBounds);

// Utility: fetch JSON file from files/ folder
function fetchJSON(path) {
    return fetch(path).then(function (r) {
        if (!r.ok) throw new Error('Failed to fetch ' + path + ': ' + r.status);
        return r.json();
    });
}

// Simple Fisher-Yates shuffle
function shuffleArray(a) {
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
    return a;
}

// Weather service that calls Open-Meteo and exposes current wind vector and precipitation/humidity
var WeatherService = (function () {
    // meters/second or km/h from API will be scaled to pixels/sec by SPEED_TO_PX
    var SPEED_TO_PX = 0.6; // tuning factor: adjust for visual speed
    var REFRESH_MS = 5 * 60 * 1000; // 5 minutes

    function toVector(windSpeed, windDirection) {
        // Open-Meteo provides meteorological wind direction degrees: 0 = north, 90 = east
        var theta = windDirection * Math.PI / 180.0;
        var vx = Math.sin(theta) * windSpeed * SPEED_TO_PX; // pixels/sec
        var vy = -Math.cos(theta) * windSpeed * SPEED_TO_PX; // negative because screen y grows downward
        return { x: vx, y: vy };
    }

    function WeatherService(lat, lon, onUpdate) {
        this.lat = lat;
        this.lon = lon;
        this.onUpdate = onUpdate;
        this.current = {
            vector: { x: 0, y: 0 },
            windSpeed: 0,
            windDirection: 0,
            precipitation: 0,
            humidity: 0
        };
        this._stopped = false;
    }

    WeatherService.prototype._applyApi = function (data) {
        var cw = data.current_weather || {};
        var windSpeed = cw.windspeed || 0; // usually km/h
        var windDirection = cw.winddirection || 0; // degrees

        // hourly arrays (time aligned). choose the hour matching current_weather.time if available
        var precipitation = 0;
        var humidity = 0;
        if (data.hourly && data.hourly.time) {
            var times = data.hourly.time;
            var target = cw.time || times[0];
            var idx = times.indexOf(target);
            if (idx === -1) idx = 0;
            if (data.hourly.precipitation && data.hourly.precipitation[idx] !== undefined) {
                precipitation = data.hourly.precipitation[idx];
            }
            if (data.hourly.relativehumidity_2m && data.hourly.relativehumidity_2m[idx] !== undefined) {
                humidity = data.hourly.relativehumidity_2m[idx];
            }
        }

        var vector = toVector(windSpeed, windDirection);
        this.current = {
            vector: vector,
            windSpeed: windSpeed,
            windDirection: windDirection,
            precipitation: precipitation,
            humidity: humidity
        };

        if (typeof this.onUpdate === 'function') this.onUpdate(this.current);
    };

    WeatherService.prototype.update = function () {
        var self = this;
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(this.lat) + '&longitude=' + encodeURIComponent(this.lon) + '&current_weather=true&hourly=precipitation,relativehumidity_2m&timezone=auto';
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            self._applyApi(data);
        }).catch(function (err) {
            console.error('Weather fetch error', err);
        });
    };

    WeatherService.prototype.start = function () {
        var self = this;
        this.update();
        this._interval = setInterval(function () { self.update(); }, REFRESH_MS);
    };

    WeatherService.prototype.stop = function () {
        if (this._interval) clearInterval(this._interval);
        this._stopped = true;
    };

    return WeatherService;
}());

// TextManager: spawns and animates text fragments
function TextManager(map, texts, originLatLng, options) {
    this.map = map;
    this.texts = shuffleArray(texts.slice()); // work on a shuffled copy
    this.origin = originLatLng; // {lat, lng}
    this.opts = Object.assign({
        spawnInterval: 1200, // ms
        maxFragments: 80,
        baseLifespan: 25.0, // seconds
        precipEffect: 0.35, // how strongly precipitation shortens lifespan
        speedJitter: 0.18 // fractional variation per fragment
    }, options || {});

    this.containerRect = this.map.getContainer().getBoundingClientRect();
    this.fragments = [];
    this._nextIndex = 0;

    // wind vectors
    this.targetWind = { x: 0, y: 0 };
    this.currentWind = { x: 0, y: 0 };

    this.currentPrecip = 0;
    this.currentHumidity = 0;

    this._lastTime = performance.now();
    this._accumulator = 0;
    this._running = false;
}

TextManager.prototype._spawnFragment = function () {
    if (this.fragments.length >= this.opts.maxFragments) return;
    var data = this.texts[this._nextIndex++ % this.texts.length];
    var content = (data && data.text !== undefined) ? String(data.text) : '';
    var el = document.createElement('div');
    el.className = 'fragment';
    el.textContent = content;
    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.pointerEvents = 'none';
    el.style.whiteSpace = 'nowrap';

    document.body.appendChild(el);

    // initial position = origin in container pixels
    var point = this.map.latLngToContainerPoint([this.origin.latitude, this.origin.longitude]);
    var rect = this.map.getContainer().getBoundingClientRect();
    var x = rect.left + point.x;
    var y = rect.top + point.y;

    var speedJitter = 1 + (Math.random() * 2 - 1) * this.opts.speedJitter;
    var lifespan = this.opts.baseLifespan / Math.max(0.2, (1 + this.currentPrecip * this.opts.precipEffect));

    var frag = {
        el: el,
        x: x,
        y: y,
        vx: this.currentWind.x * speedJitter,
        vy: this.currentWind.y * speedJitter,
        createdAt: performance.now(),
        lifespan: lifespan * 1000, // ms
        jitter: speedJitter
    };

    // place it initially
    el.style.transform = 'translate(' + frag.x + 'px, ' + frag.y + 'px) translate(-50%,-50%)';
    this.fragments.push(frag);
};

TextManager.prototype._removeFragment = function (idx) {
    var f = this.fragments[idx];
    if (f) {
        if (f.el && f.el.parentNode) f.el.parentNode.removeChild(f.el);
        this.fragments.splice(idx, 1);
    }
};

TextManager.prototype.setWind = function (wind, precipitation, humidity) {
    // wind: {x,y} in pixels/sec
    this.targetWind = wind || { x: 0, y: 0 };
    this.currentPrecip = precipitation || 0;
    this.currentHumidity = humidity || 0;
};

TextManager.prototype._update = function (now) {
    var dt = (now - this._lastTime) / 1000.0; // seconds
    this._lastTime = now;

    // smooth currentWind -> targetWind
    var smoothTau = 2.5; // seconds to approach new wind
    var alpha = Math.min(1, dt / smoothTau);
    this.currentWind.x += (this.targetWind.x - this.currentWind.x) * alpha;
    this.currentWind.y += (this.targetWind.y - this.currentWind.y) * alpha;

    // spawning accumulator
    this._accumulator += dt * 1000;
    while (this._accumulator >= this.opts.spawnInterval) {
        this._accumulator -= this.opts.spawnInterval;
        this._spawnFragment();
    }

    // update fragments
    for (var i = this.fragments.length - 1; i >= 0; i--) {
        var f = this.fragments[i];
        // update velocity to match current wind but keep fragment's jitter
        f.vx = this.currentWind.x * f.jitter;
        f.vy = this.currentWind.y * f.jitter;

        f.x += f.vx * dt;
        f.y += f.vy * dt;

        var age = now - f.createdAt;
        var lifeRatio = age / f.lifespan;

        // opacity and scale
        var opacity = Math.max(0, 1 - lifeRatio);
        var scale = 1 - 0.12 * Math.min(1, lifeRatio);

        f.el.style.transform = 'translate(' + f.x + 'px, ' + f.y + 'px) translate(-50%,-50%) scale(' + scale + ')';
        f.el.style.opacity = opacity;

        // optional: precipitation can add a slight blur / transform by adjusting filter
        if (this.currentPrecip > 0.5) {
            var blur = Math.min(2.2, this.currentPrecip * 0.6);
            f.el.style.filter = 'blur(' + blur + 'px)';
        } else {
            f.el.style.filter = '';
        }

        if (age > f.lifespan) {
            this._removeFragment(i);
        }
    }
};

TextManager.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    var self = this;

    function frame(now) {
        if (!self._running) return;
        self._update(now);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

TextManager.prototype.stop = function () {
    this._running = false;
    // remove existing fragments
    for (var i = this.fragments.length - 1; i >= 0; i--) {
        this._removeFragment(i);
    }
};

// Main app flow
Promise.all([fetchJSON('files/locations.json'), fetchJSON('files/text.json')]).then(function (results) {
    var locations = results[0];
    var texts = results[1];

    if (!Array.isArray(locations) || locations.length === 0) {
        console.error('No locations found');
        return;
    }
    if (!Array.isArray(texts) || texts.length === 0) {
        console.error('No text fragments found');
        return;
    }

    // random origin selection (one of the 77 locations)
    var origin = locations[Math.floor(Math.random() * locations.length)];
    console.log('Selected origin', origin);

    // center map on origin with a comfortable zoom
    map.setView([origin.latitude, origin.longitude], 13);

    // create text manager
    var tm = new TextManager(map, texts, { latitude: origin.latitude, longitude: origin.longitude });
    tm.start();

    // create weather service and wire updates into text manager
    var ws = new WeatherService(origin.latitude, origin.longitude, function (current) {
        // current.vector is in pixels/sec already
        tm.setWind(current.vector, current.precipitation, current.humidity);
    });
    ws.start();

}).catch(function (err) {
    console.error('Startup error', err);
});

    
