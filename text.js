// Wind speed of 1 m/sec equals 1 screen pixel/sec
const WIND_SPEED_TO_PIXEL_SPEED = 1;

// Randomize the fragment order with the Fisher-Yates shuffle algorithm
function shuffle(text) {
    for (let i = text.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [text[i], text[j]] = [text[j], text[i]];
    }
    // Return the now-shuffled array 
    return text;
}

// Define text manager that spawns and animates fragments
function TextManager(map, text, originLatLng, options) {
    this.map = map;
    // Copy and shuffle the input text 
    this.text = shuffle(text.slice());
    this.origin = originLatLng;
    // Combine default settings with any settings supplied by the caller
    this.opts = Object.assign({
        // Set the time between fragment spawns in milliseconds
        spawnInterval: 1200,
        // Set the default upper limit on simultaneously active fragments
        maxFragments: 105,
        // Set each fragment's lifespan in seconds
        baseLifespan: 125,
        // Set the maximum random percentage by which wind speed can vary per fragment
        speedJitter: 0.18,
        // Set how many seconds velocity smoothing should take; zero disables smoothing
        windSmoothingSeconds: 0
    }, options);
    // Convert the configured lifespan from seconds to milliseconds
    this.lifespanMilliseconds = this.opts.baseLifespan * 1000;
    // Calculate how many fragments can spawn during one fragment's lifespan
    const capacityForContinuousSpawning = Math.ceil(this.lifespanMilliseconds / this.opts.spawnInterval);
    // Check whether the preconfigured capacity would prevent the timer from spawning continuously
    if (this.opts.maxFragments < capacityForContinuousSpawning) {
        // Raise the limit so active fragments do not block later scheduled spawns
        this.opts.maxFragments = capacityForContinuousSpawning;
    }
    // Keep the shared weather manager, or use null when none was provided
    this.weather = this.opts.weather || null;
    // Initialize empty active fragments array
    this.fragments = [];
    // Start the index used to cycle through the shuffled text array at zero
    this._nextIndex = 0;
    // Start with no leftover milliseconds accumulated toward the next spawn
    this._accumulator = 0;
    // Record when local wind information was last printed to the console
    this._lastWindLogAt = 0;
    // Track whether the current fragment-capacity warning has already been printed
    this._capacityWarning = false;
    // Store the visibility event handler so it can later be removed
    this._handleVisibilityChange = null;
    // Mark the animation loop as not running until start() is called
    this._running = false;
}

// Create and register one fragment element
TextManager.prototype._spawnFragment = function () {
    // Refuse to create another fragment when the active count has reached its limit
    if (this.fragments.length >= this.opts.maxFragments) {
        // Print the capacity warning only once while the limit continues to be reached
        if (!this._capacityWarning) {
            console.warn('BADKOOBEH fragment spawn reached its capacity', {
                activeFragments: this.fragments.length,
                maxFragments: this.opts.maxFragments
            });
            // Remember that the warning has been printed to avoid repeating it every frame
            this._capacityWarning = true;
        }
        // Stop this spawn attempt because there is no remaining capacity
        return;
    }
    // Allow a future capacity warning after the active count drops below the limit
    this._capacityWarning = false;
    
    // Select the next shuffled text item via post-increment and wrap back to the start after the last item
    const data = this.text[this._nextIndex++ % this.text.length];
    // Convert the item's text value to a string, or use empty string if it is missing
    const content = (data && data.text !== undefined) ? String(data.text) : '';
    // Create a new HTML div that will display the fragment
    const element = document.createElement('div');
    // Add the CSS class used to style all fragment elements
    element.className = 'fragment';
    // Put the fragment's text into the element as text
    element.textContent = content;
    // Position the element relative to its map container
    element.style.position = 'absolute';
    // Set its initial left offset to zero 
    element.style.left = '0px';
    // Set its initial top offset to zero 
    element.style.top = '0px';
    // Prevent the fragment from intercepting mouse or touch input
    element.style.pointerEvents = 'none';
    // Keep the text on one line instead of wrapping within the map
    element.style.whiteSpace = 'nowrap';
    // Add the fragment element to the map's visible container
    this.map.getContainer().appendChild(element);

    // Convert the origin latitude and longitude to number
    const latitude = Number(this.origin.latitude);
    const longitude = Number(this.origin.longitude);
    // Convert the fixed geographic origin into a pixel position inside the map container
    const point = this.map.latLngToContainerPoint([latitude, longitude]);
    // Choose a stable per-fragment speed multiplier within the configured jitter range
    const speedJitter = 1 + (Math.random() * 2 - 1) * this.opts.speedJitter;
    // Create the state object that the animation loop will update for this fragment
    const fragment = {
        // Keep a reference to the DOM node so it can be moved and removed later
        element: element,
        // Store the fragment's initial horizontal and vertical position in container pixels
        x: point.x,
        y: point.y,
        // Start with no horizontal and vertical velocity until the first wind lookup
        vx: 0,
        vy: 0,
        jitter: speedJitter,
        createdAt: performance.now(),
        lifespan: this.lifespanMilliseconds
    };
    // Place the new element at its origin using a CSS pixel translation
    element.style.transform = 'translate(' + fragment.x + 'px, ' + fragment.y + 'px)';
    // Add the new fragment state to the list processed by each animation update
    this.fragments.push(fragment);
};

// Define the method that removes one fragment from both the page and active list.
TextManager.prototype._removeFragment = function (index) {
    // Get the fragment state at the requested array index.
    const fragment = this.fragments[index];
    // Do nothing if that index does not contain a fragment.
    if (!fragment) return;
    // Check that the fragment still has a DOM node attached to a parent.
    if (fragment.element && fragment.element.parentNode) {
        // Remove the fragment's DOM node from the page.
        fragment.element.parentNode.removeChild(fragment.element);
    }
    // Remove the fragment state from the active list.
    this.fragments.splice(index, 1);
};

// Define one movement update for a fragment using the wind at its current position.
TextManager.prototype._moveFragment = function (fragment, deltaTime, timestamp) {
    // Convert the fragment's current container-pixel position back to latitude and longitude.
    const location = this.map.containerPointToLatLng([fragment.x, fragment.y]);
    // Ask the shared weather manager for the wind at those coordinates and this time.
    const wind = this.weather
        // Use the location-specific wind vector when a weather manager is available.
        ? this.weather.getWindAt(location.lat, location.lng, timestamp)
        // Treat the wind as unavailable if no weather manager was supplied.
        : null;

    // Check whether the weather field could not provide a wind estimate here and now.
    if (!wind) {
        // Limit unavailable-wind diagnostics to at most one message every ten seconds.
        if (timestamp - this._lastWindLogAt >= 10000) {
            // Save this log time so other fragments do not immediately print another message.
            this._lastWindLogAt = timestamp;
            // Report the coordinates and time for which no wind estimate was available.
            console.warn('BADKOOBEH wind unavailable at current fragment position', {
                // Include the latitude rounded to five decimal places for readability.
                latitude: Number(location.lat.toFixed(5)),
                // Include the longitude rounded to five decimal places for readability.
                longitude: Number(location.lng.toFixed(5)),
                // Include the timestamp as a standard ISO date-time string.
                timestamp: new Date(timestamp).toISOString()
            });
        }
        // Stop horizontal movement when no valid local wind vector exists.
        fragment.vx = 0;
        // Stop vertical movement when no valid local wind vector exists.
        fragment.vy = 0;
        // Skip the rest of this movement update because there is no wind to apply.
        return;
    }

    // Convert eastward wind speed into a horizontal pixel velocity and apply this fragment's multiplier.
    const targetVx = wind.east * WIND_SPEED_TO_PIXEL_SPEED * fragment.jitter;
    // Convert northward wind speed into an upward screen velocity and apply this fragment's multiplier.
    const targetVy = -wind.north * WIND_SPEED_TO_PIXEL_SPEED * fragment.jitter;
    // Choose an easing fraction that follows wind immediately or smooths toward it over time.
    const alpha = this.opts.windSmoothingSeconds > 0
        // Limit the smoothing fraction to one so it never overshoots the target velocity.
        ? Math.min(1, deltaTime / this.opts.windSmoothingSeconds)
        // Use the full target velocity when smoothing is disabled.
        : 1;
    // Move horizontal velocity partway from its current value toward the local wind velocity.
    fragment.vx += (targetVx - fragment.vx) * alpha;
    // Move vertical velocity partway from its current value toward the local wind velocity.
    fragment.vy += (targetVy - fragment.vy) * alpha;
    // Advance horizontal position by horizontal velocity multiplied by elapsed seconds.
    fragment.x += fragment.vx * deltaTime;
    // Advance vertical position by vertical velocity multiplied by elapsed seconds.
    fragment.y += fragment.vy * deltaTime;

    // Print wind diagnostics no more often than once every ten seconds.
    if (timestamp - this._lastWindLogAt >= 10000) {
        // Save the timestamp to enforce the diagnostic logging interval.
        this._lastWindLogAt = timestamp;
        // Calculate the total wind speed from its east and north components.
        const speed = Math.hypot(wind.east, wind.north);
        // Calculate compass direction toward which wind blows, unless its speed is zero.
        const directionToward = speed === 0
            // Use null because a zero-speed vector has no defined direction.
            ? null
            // Convert the vector's angle to a compass bearing from zero to 359.9 degrees.
            : (Math.atan2(wind.east, wind.north) * 180 / Math.PI + 360) % 360;
        // Print the local wind, location, and resulting on-screen velocity for debugging.
        console.info('BADKOOBEH current local wind', {
            // Include the fragment's current latitude rounded to five decimal places.
            latitude: Number(location.lat.toFixed(5)),
            // Include the fragment's current longitude rounded to five decimal places.
            longitude: Number(location.lng.toFixed(5)),
            // Include the total wind speed rounded to two decimal places in metres per second.
            speedMetersPerSecond: Number(speed.toFixed(2)),
            // Include the direction rounded to one decimal place, or null when speed is zero.
            directionTowardDegrees: directionToward === null ? null : Number(directionToward.toFixed(1)),
            // Include the eastward component rounded to two decimal places.
            eastMetersPerSecond: Number(wind.east.toFixed(2)),
            // Include the northward component rounded to two decimal places.
            northMetersPerSecond: Number(wind.north.toFixed(2)),
            // Group the fragment's resulting screen-space velocity components together.
            screenVelocityPixelsPerSecond: {
                // Include the horizontal velocity rounded to two decimal places.
                x: Number(fragment.vx.toFixed(2)),
                // Include the vertical velocity rounded to two decimal places.
                y: Number(fragment.vy.toFixed(2))
            }
        });
    }
};

// Define the method that advances spawning, movement, age, opacity, and scale for a frame.
TextManager.prototype._update = function (now) {
    // Convert the high-resolution frame-time difference from milliseconds to seconds.
    const deltaTime = Math.max(0, (now - this._lastTime) / 1000);
    // Save this frame time so the next update can calculate its elapsed duration.
    this._lastTime = now;
    // Read wall-clock time once for origin checks and fragment wind lookups in this frame.
    const simulationTime = Date.now();

    // Iterate backward so expired fragments can be removed without skipping the next item.
    for (let i = this.fragments.length - 1; i >= 0; i--) {
        // Get the fragment whose state will be updated during this pass.
        const fragment = this.fragments[i];
        // Calculate this fragment's age in milliseconds from its creation time.
        const age = now - fragment.createdAt;
        // Check whether this fragment has lived longer than its configured lifespan.
        if (age >= fragment.lifespan) {
            // Remove an expired fragment from the screen and active list.
            this._removeFragment(i);
            // Skip movement and visual updates for the fragment that was just removed.
            continue;
        }

        // Update the fragment's position using wind at its current geographic coordinates.
        this._moveFragment(fragment, deltaTime, simulationTime);
        // Convert the fragment's age into a fraction from zero to one over its full life.
        const lifeRatio = age / fragment.lifespan;
        // Fade the fragment linearly from full opacity to transparent as it ages.
        const opacity = Math.max(0, 1 - lifeRatio);
        // Shrink the fragment by up to twelve percent over its lifespan.
        const scale = 1 - 0.12 * Math.min(1, lifeRatio);
        // Apply its current pixel position and age-based scale through a CSS transform.
        fragment.element.style.transform = 'translate(' + fragment.x + 'px, ' + fragment.y + 'px) scale(' + scale + ')';
        // Apply the calculated age-based opacity to the fragment element.
        fragment.element.style.opacity = opacity;
    }

    // Accumulate elapsed milliseconds so spawning remains tied to the configured interval.
    this._accumulator += deltaTime * 1000;
    // Spawn once for each full interval that has elapsed, including multiple intervals after a delayed frame.
    while (this._accumulator >= this.opts.spawnInterval) {
        // Subtract one interval because this loop is handling one scheduled spawn.
        this._accumulator -= this.opts.spawnInterval;
        // Create one fragment at the fixed session origin after expired fragments have been removed.
        this._spawnFragment();
    }
};

// Define the method that starts the animation loop and visibility handling.
TextManager.prototype.start = function () {
    // Avoid starting a second animation loop if this manager is already running.
    if (this._running) return;
    // Mark the manager as running so the animation callback will continue scheduling frames.
    this._running = true;
    // Reset the frame-time baseline to the current high-resolution time.
    this._lastTime = performance.now();
    // Create a handler that resets timing when the browser tab becomes hidden or visible.
    this._handleVisibilityChange = () => {
        // Reset the previous-frame timestamp so a hidden period is not counted as active time.
        this._lastTime = performance.now();
        // Discard partial spawn progress accumulated before the visibility change.
        this._accumulator = 0;
        // Log a resume message only when the page is visible and the manager is running.
        if (this._running && !document.hidden) {
            // Report how many fragments remained active when the animation resumed.
            console.info('BADKOOBEH simulation resumed', { activeFragments: this.fragments.length });
        }
    };
    // Listen for browser visibility changes so animation timing can be reset appropriately.
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
    // Create one animation-frame callback that keeps the simulation updating.
    const frame = (now) => {
        // Stop scheduling frames after stop() changes the running flag.
        if (!this._running) return;
        // Check whether the browser page is currently hidden.
        if (document.hidden) {
            // Keep the time baseline current while hidden to avoid a large elapsed-time jump.
            this._lastTime = now;
            // Clear partial spawn time while hidden so it does not accumulate in the background.
            this._accumulator = 0;
        // Run a normal update while the page is visible.
        } else {
            // Advance fragment creation, motion, lifetime, and appearance for this frame.
            this._update(now);
        }
        // Ask the browser to call this animation callback again for the next frame.
        requestAnimationFrame(frame);
    };
    // Request the first animation frame, which starts the recurring update loop.
    requestAnimationFrame(frame);
};

// Define the method that stops the animation loop and removes all active fragments.
TextManager.prototype.stop = function () {
    // Mark the manager stopped so any later animation callback exits without rescheduling.
    this._running = false;
    // Check whether a visibility event handler was previously installed.
    if (this._handleVisibilityChange) {
        // Remove the handler so this stopped manager no longer listens for tab changes.
        document.removeEventListener('visibilitychange', this._handleVisibilityChange);
        // Clear the saved function reference to show there is no registered handler.
        this._handleVisibilityChange = null;
    }
    // Walk backward through active fragments so each can safely be removed from the array.
    for (let i = this.fragments.length - 1; i >= 0; i--) {
        // Remove this fragment's DOM element and state from the manager.
        this._removeFragment(i);
    }
};
