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

// Create constructor function that spawns and animates text fragments
function TextManager(map, text, originLatLng, options) {
    this.map = map;
    this.text = shuffle(text.slice()); // work on a shuffled copy
    this.origin = originLatLng; // {lat, lng}
    this.opts = Object.assign({
        spawnInterval: 1200, // ms
        maxFragments: 80,
        baseLifespan: 25.0, // seconds
        precipEffect: 0.35, // how strongly precipitation shortens lifespan
        speedJitter: 0.18 // fractional variation per fragment
    }, options || {});
    // get map parameters for positioning
    this.containerRect = this.map.getContainer().getBoundingClientRect();
    this.fragments = []; // active fragments
    this._nextIndex = 0; // next fragment index in the shuffled text array
    this.targetWind = { x: 0, y: 0 }; // new wind vector in pixels/sec
    this.currentWind = { x: 0, y: 0 }; // current wind vector in pixels/sec
    this.currentPrecip = 0;
    this.currentRelativeHumidity = 0;
    this._lastTime = performance.now(); 
    this._accumulator = 0; 
    this._running = false;
}
// Spawn new text fragment
TextManager.prototype._spawnFragment = function () {
    if (this.fragments.length >= this.opts.maxFragments) return; // don't spawn more than maxFragments
    var data = this.text[this._nextIndex++ % this.text.length]; // loop through text array
    var content = (data && data.text !== undefined) ? String(data.text) : ''; // turn data.text into a string, default to empty string if undefined
    var element = document.createElement('div'); // create new div element 
    element.className = 'fragment'; // assign class for styling
    element.textContent = content; // put fragment text inside div
    element.style.position = 'absolute'; 
    element.style.left = '0px';
    element.style.top = '0px';
    element.style.pointerEvents = 'none'; // no mouse interaction
    element.style.whiteSpace = 'nowrap';

    this.map.getContainer().appendChild(element); // add DOM element to map
    // convert geographic coordinates into map container points
    var point = this.map.latLngToContainerPoint([this.origin.latitude, this.origin.longitude]); 
    var x = point.x; // x position
    var y = point.y; // y position

    var speedJitter = 1 + (Math.random() * 2 - 1) * this.opts.speedJitter; // randomize speed a bit for each fragment
    // decay based on precipitation (HUMIDITY?)
    var lifespan = this.opts.baseLifespan / Math.max(0.2, (1 + this.currentPrecip * this.opts.precipEffect)); 
    
    // create a fragment object to track its state
    var fragment = {
        element: element, // the DOM element for this fragment
        x: x, // current x position
        y: y, // current y position
        vx: this.currentWind.x * speedJitter, // x velocity
        vy: this.currentWind.y * speedJitter, // y velocity
        createdAt: performance.now(), // track creation time
        lifespan: lifespan * 1000, // lifespan in milliseconds
        jitter: speedJitter // individual speed jitter 
    };

    // place element at its initial position
    element.style.transform = 'translate(' + fragment.x + 'px, ' + fragment.y + 'px)';
    this.fragments.push(fragment); // push fragment to active fragments
};

// Remove fragment if it exists
TextManager.prototype._removeFragment = function (index) {
    var f = this.fragments[index];
    if (f) {
        if (f.element && f.element.parentNode) f.element.parentNode.removeChild(f.element); // remove fragment visually
        // remove fragment from active fragments array
        this.fragments.splice(index, 1);
    }
};

//
TextManager.prototype.getWeather = function (wind, precipitation, relativeHumidity) {
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

        f.element.style.transform = 'translate(' + f.x + 'px, ' + f.y + 'px) translate(-50%,-50%) scale(' + scale + ')';
        f.element.style.opacity = opacity;

        // optional: precipitation can add a slight blur / transform by adjusting filter
        if (this.currentPrecip > 0.5) {
            var blur = Math.min(2.2, this.currentPrecip * 0.6);
            f.element.style.filter = 'blur(' + blur + 'px)';
        } else {
            f.element.style.filter = '';
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



    
