// Randomize sequence of text fragments using Fisher-Yates shuffle
function shuffle(text) {
    for (let i = text.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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
        maxFragments: 80, // max number of fragments on screen
        baseLifespan: 25.0, // seconds
        speedJitter: 0.18 // fractional variation per fragment
    }, options || {});
    this.fragments = []; // active fragments
    this._nextIndex = 0; // next fragment index in the shuffled text array
    this.targetWind = { x: 0, y: 0 }; // new wind vector in pixels/sec
    this.currentWind = { x: 0, y: 0 }; // current wind vector in pixels/sec
    this._lastTime = performance.now(); 
    this._accumulator = 0; // accumulated time 
    this._running = false;
}
// Spawn new text fragment
TextManager.prototype._spawnFragment = function () {
    if (this.fragments.length >= this.opts.maxFragments) return; // don't spawn more than maxFragments
    const data = this.text[this._nextIndex++ % this.text.length]; // loop through text array
    const content = (data && data.text !== undefined) ? String(data.text) : ''; // turn data.text into a string, default to empty string if undefined
    const element = document.createElement('div'); // create new div element 
    element.className = 'fragment'; // assign class for styling
    element.textContent = content; // put fragment text inside div
    element.style.position = 'absolute'; 
    element.style.left = '0px';
    element.style.top = '0px';
    element.style.pointerEvents = 'none'; // no mouse interaction
    element.style.whiteSpace = 'nowrap';

    this.map.getContainer().appendChild(element); // add DOM element to map
    // convert geographic coordinates into map container points
    const point = this.map.latLngToContainerPoint([this.origin.latitude, this.origin.longitude]); 
    const x = point.x; // x position
    const y = point.y; // y position

    const speedJitter = 1 + (Math.random() * 2 - 1) * this.opts.speedJitter; // randomize speed a bit for each fragment
    const lifespan = this.opts.baseLifespan / 0.2; 
    
    // create a fragment object to track its state
    const fragment = {
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
    const f = this.fragments[index];
    if (f) {
        if (f.element && f.element.parentNode) f.element.parentNode.removeChild(f.element); // remove fragment visually
        // remove fragment from active fragments array
        this.fragments.splice(index, 1);
    }
};

// Get weather data
TextManager.prototype.getWeather = function (wind) {
    this.targetWind = wind || { x: 0, y: 0 };
};

// Animate fragments
TextManager.prototype._update = function (now) {
    const deltaTime = (now - this._lastTime) / 1000.0; // time that has passed since last _update call in seconds
    this._lastTime = now; // update last time to now for next _update call

    // smooth currentWind -> targetWind
    const smoothTau = 2.5; // seconds it takes to approach new wind direction
    const alpha = Math.min(1, deltaTime / smoothTau);
    this.currentWind.x += (this.targetWind.x - this.currentWind.x) * alpha; // gradual movement on x axis
    this.currentWind.y += (this.targetWind.y - this.currentWind.y) * alpha; // gradual movement on y axis

    // spawn new fragment when accumulated time exceeds preset interval
    this._accumulator += deltaTime * 1000;
    while (this._accumulator >= this.opts.spawnInterval) {
        this._accumulator -= this.opts.spawnInterval;
        this._spawnFragment();
    }

    // update fragments
    for (let i = this.fragments.length - 1; i >= 0; i--) {
        const f = this.fragments[i];
        // update velocity to match current wind but keep fragment's jitter
        f.vx = this.currentWind.x * f.jitter;
        f.vy = this.currentWind.y * f.jitter;
        // update fragment's position
        f.x += f.vx * deltaTime;
        f.y += f.vy * deltaTime;
        const age = now - f.createdAt; // how old fragment is
        const lifeRatio = age / f.lifespan; // how far through its lifespan fragment is
        // fragment fades out
        const opacity = Math.max(0, 1 - lifeRatio);
        // shrink text size
        const scale = 1 - 0.12 * Math.min(1, lifeRatio);
        //  move the DOM element to its calculated position and apply scale to it
        f.element.style.transform = 'translate(' + f.x + 'px, ' + f.y + 'px)  scale(' + scale + ')';
        f.element.style.opacity = opacity; // apply opacity to the DOM element
        // remove fragment once it reaches its lifespan
        if (age > f.lifespan) {
            this._removeFragment(i);
        }
    }
};

// Start animation loop
TextManager.prototype.start = function () {
    if (this._running) return; // exit if animation is already running
    this._running = true; // mark animation as running
    this._lastTime = performance.now(); // record starting time
    const frame = (now) => {
        if (!this._running) return; // exit if animation has been stopped 
        this._update(now);
        requestAnimationFrame(frame); // schedule next frame
    }
    requestAnimationFrame(frame); // start animation loop
};

// Stop animation loop
TextManager.prototype.stop = function () {
    this._running = false; // mark animation as stopped
    // remove existing fragments
    for (let i = this.fragments.length - 1; i >= 0; i--) {
        this._removeFragment(i);
    }
};