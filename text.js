// Helper function to fetch JSON and handle errors
function fetchJSON(path) {
    return fetch(path).then(function (r) {
        if (!r.ok) throw new Error('Failed to fetch ' + path + ': ' + r.status);
        return r.json();
    });
}

// Randomize sequence of text fragments using Fisher-Yates shuffle
function shuffle(text) {
    for (var i = text.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        [text[i], text[j]] = [text[j], text[i]];
    }
    return text;
}

// TextManager: spawns and animates text fragments
function TextManager(map, texts, originLatLng, options) {
    this.map = map;
    this.texts = shuffle(texts.slice()); // work on a shuffled copy
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
    this.currentRelativeHumidity = 0;

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

TextManager.prototype.setWind = function (wind, precipitation, relativeHumidity) {
    // wind: {x,y} in pixels/sec
    this.targetWind = wind || { x: 0, y: 0 };
    this.currentPrecip = precipitation || 0;
    this.currentRelativeHumidity = relativeHumidity || 0;
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

    // create weather manager and wire updates into text manager
    var ws = new WeatherManager(origin.latitude, origin.longitude, function (current) {
        // current.vector is in pixels/sec already
        tm.setWind(current.vector, current.precipitation, current.relativeHumidity);
    });
    ws.start();

}).catch(function (err) {
    console.error('Startup error', err);
});

    
