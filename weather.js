// Define the shared wind-data service, which fetches one grid for all fragments
const WeatherManager = (function () {
    // Set the requested spacing between geographic weather sample points to 9 km
    const MODEL_GRID_SPACING_METERS = 9000;
    // Use Earth's average radius when estimating distances between nearby coordinates
    const EARTH_RADIUS_METERS = 6371000;
    // Degrees to meters conversion factor for latitude, which is constant everywhere on Earth
    const METERS_PER_DEGREE_LATITUDE = 111320;
    // When two locations are within this distance, they are considered the same for wind-relative positioning
    const SAME_LOCATION_THRESHOLD_METERS = 1;


    // Build the geographic sample-point grid covering and padding the map territory 
    function buildGrid(territoryBounds) {
        // Read territory's corners
        const southWest = territoryBounds.getSouthWest();
        const northEast = territoryBounds.getNorthEast();
        // Convert 9 km into approximate degrees of latitude
        const latitudeDegree = MODEL_GRID_SPACING_METERS / METERS_PER_DEGREE_LATITUDE;
        // Estimate the territory's middle latitude for longitude-distance conversion
        const middleLatitude = (southWest.lat + northEast.lat) / 2;
        // Convert 9 km into approximate degrees of longitude at the middle latitude
        const longitudeDegree = MODEL_GRID_SPACING_METERS /
            (METERS_PER_DEGREE_LATITUDE * Math.cos(middleLatitude * Math.PI / 180));
        // Create array that will hold every requested latitude-longitude point
        const points = [];
        // Add a buffer around the territory so edge fragments have nearby samples
        const minLatitude = southWest.lat - latitudeDegree;
        const maxLatitude = northEast.lat + latitudeDegree;
        const minLongitude = southWest.lng - longitudeDegree;
        const maxLongitude = northEast.lng + longitudeDegree;
        // For each latititude row in the padded territory, generate a series of longitude points
        for (let latitude = minLatitude; latitude <= maxLatitude + latitudeDegree / 2; latitude += latitudeDegree) {
            for (let longitude = minLongitude; longitude <= maxLongitude + longitudeDegree / 2; longitude += longitudeDegree) {
                // Add grid coordinate to the array of requested points 
                points.push({ latitude: latitude, longitude: longitude });
            }
        }
        // Return requested points and their outermost coordinate bounds
        return {
            points: points,
            // Store coordinate limits used later to reject locations outside the grid.
            bounds: {
                // Grid's lower bound
                minLatitude: points[0].latitude,
                // Grid's upper bound
                maxLatitude: points[points.length - 1].latitude,
                // Grid's western bound
                minLongitude: points[0].longitude,
                // Grid's eastern bound
                maxLongitude: points[points.length - 1].longitude
            }
        };
    }

    // Convert wind speed and direction into fragment-friendly eastward and northward components
    function toWindComponents(speed, direction) {
        // Reject missing, invalid or negative wind speed
        if (!Number.isFinite(speed) || speed < 0) return null;
        // Represent calm wind  with no eastward or northward movement
        if (speed === 0) return { east: 0, north: 0 };
        // Reject non-numeric direction
        if (!Number.isFinite(direction)) return null;
        // Convert degrees to radians for JavaScript's trigonometric functions
        const radians = (direction * Math.PI)  / 180;
        // Return east and north components with minus signs to reverse direction
        return {
            east: -speed * Math.sin(radians),
            north: -speed * Math.cos(radians)
        };
    }

    // Find or interpolate one sample's wind vector at the requested timestamp
    function getTimedVector(sample, timestamp) {
        // Read the array of timestamps associated with this weather sample
        const times = sample.times;
        // Initialize the lower edge of a binary search at the first hourly value
        let low = 0;
        // Initialize the upper edge of the search at the final hourly value
        let high = times.length - 1;
        // Return no estimate if the sample has no times or the request is outside its available range
        if (!times.length || timestamp < times[low] || timestamp > times[high]) return null;
        // Search the sorted timestamps until an exact match or the surrounding pair is found
        while (low <= high) {
            // Choose the middle index of the remaining search range
            const middle = Math.floor((low + high) / 2);
            // Check whether the middle weather value exactly matches the requested time
            if (times[middle] === timestamp) {
                // Read the vector stored for this exact time
                const exact = sample.vectors[middle];
                // Return a copy of the exact vector, or null if its data is missing
                return exact ? { east: exact.east, north: exact.north } : null;
            }
            // If the middle time is earlier than requested, continue searching the upper half
            if (times[middle] < timestamp) low = middle + 1;
            // Else, continue searching the lower half of the time array
            else high = middle - 1;
        }
        // If no match is found, the loop exits when high is the last index before the requested time 
        // And low is the first index after it
        const beforeIndex = high;
        const afterIndex = low;
        // Read the vector from the earlier and later time samples
        const before = sample.vectors[beforeIndex];
        const after = sample.vectors[afterIndex];
        // Refuse interpolation if either sample is missing data
        if (!before || !after) return null;
        // Calculate the requested time's fractional position between two samples
        const ratio = (timestamp - times[beforeIndex]) / (times[afterIndex] - times[beforeIndex]);
        // Interpolate estimated east and north components between two samples
        return {
            east: before.east + (after.east - before.east) * ratio,
            north: before.north + (after.north - before.north) * ratio
        };
    }

    // Estimate straight-line distance in metres between given coordinate and nearest weather sample
    function distanceMeters(latitude, longitude, sample) {
        // Find the average latitude and convert it to radians
        const middleLatitude = (latitude + sample.latitude) / 2 * (Math.PI / 180);
        // Approximate east-west and north-south separation, accounting for longitude lines narrowing toward the poles
        const east = (sample.longitude - longitude) * (Math.PI / 180) * EARTH_RADIUS_METERS * Math.cos(middleLatitude);
        const north = (sample.latitude - latitude) * (Math.PI / 180) * EARTH_RADIUS_METERS;
        // Combine the perpendicular east and north distances with Pythagorean theorem
        return Math.sqrt(east * east + north * north);
    }

    // Create a single instance of weather manager with shared grid 
    // From which all fragments can interpolate wind data
    // Without each fragment making its own network requests to Open-Meteo 
    function WeatherManager(territoryBounds) {
        const grid = buildGrid(territoryBounds);
        // Store coordinate points to be requested from Open-Meteo
        this.queryPoints = grid.points;
        // Store outer edge coordinates
        this.bounds = grid.bounds;
        // Initialize empty array of unique samples returned by Open-Meteo (cached)
        this.samples = [];
        // Track ongoing network request to avoid duplicate fetches 
        this._pending = null;
        // Track the promise for the initial weather-grid request so it can be reused by other callers
        this._startPromise = null;
    }

    // Convert an Open-Meteo response into manager's internal sample grid format
    WeatherManager.prototype._applyApi = function (response) {
        // Make sure response is an array, turn it into one if Open-Meteo returns a single object
        const entries = Array.isArray(response) ? response : [response];
        // Issue an error if number of returned entries do not match number of requested coordinates
        if (entries.length !== this.queryPoints.length) {
            throw new Error('Open-Meteo returned an unexpected number of weather-grid points');
        }
        // Create map to store only one sample for each returned model-cell coordinate (deduplication)
        const samplesByCell = new Map();
        // Count entries that contain valid hourly arrays
        let usableEntries = 0;
        // Count entries that share a model cell with an earlier entry and are therefore ignored
        let duplicateCells = 0;
        // Process each weather response entry alongside its requested coordinate
        for (let i = 0; i < entries.length; i++) {
            // Use an empty object if an individual response entry is unexpectedly missing
            const entry = entries[i] || {};
            // Read hourly forecast section, or an empty object if it was omitted
            const hourly = entry.hourly || {};
            // Convert each Unix timestamp from seconds to JavaScript milliseconds
            const times = Array.isArray(hourly.time)
                ? hourly.time.map(function (value) { return Number(value) * 1000; })
                // Use an empty array when hourly timestamp list is missing or malformed
                : [];
            // Read hourly ten-metre wind-speed and direction values
            const speeds = hourly.wind_speed_10m || [];
            const directions = hourly.wind_direction_10m || [];
            // Skip to next iteration unless timestamps are complete and numeric
            if (!times.length || times.some(function (time) { return !Number.isFinite(time); }) ||
                // Skip to next iteration if the number of speeds or directions does not match the number of timestamps
                speeds.length !== times.length || directions.length !== times.length) continue;
            // Count this response entry as structurally usable 
            usableEntries++;
            // Use the model's returned latitude when valid, otherwise use the requested latitude
            const latitude = entry.latitude !== null && entry.latitude !== undefined && Number.isFinite(Number(entry.latitude))
                // Convert a valid returned latitude into a number
                ? Number(entry.latitude) : this.queryPoints[i].latitude;
            // Use the model's returned longitude when valid, otherwise use the requested longitude
            const longitude = entry.longitude !== null && entry.longitude !== undefined && Number.isFinite(Number(entry.longitude))
                ? Number(entry.longitude) : this.queryPoints[i].longitude;
            // Build a stable key from the returned coordinates
            const cellKey = latitude + ',' + longitude;
            // Skip to next iteration when an earlier requested point already resolved to this same model cell
            if (samplesByCell.has(cellKey)) {
                // Increment duplicates counter
                duplicateCells++;
                continue;
            }
            // Store the unique cell's position, time axis, and converted wind vectors
            samplesByCell.set(cellKey, {
                latitude: latitude,
                longitude: longitude,
                times: times,
                // Convert each hourly speed and direction into a wind vector that the app can use
                vectors: times.map(function (_, timeIndex) {
                    // Read the speed and direction value for this hour and convert them to a number
                    const speed = Number(speeds[timeIndex]);
                    const direction = Number(directions[timeIndex]);
                    // Preserve a missing speed as missing data
                    if (speeds[timeIndex] === null || speeds[timeIndex] === undefined) return null;
                    // Preserve a missing direction as missing data only when speed is non-zero
                    if (speed !== 0 && (directions[timeIndex] === null || directions[timeIndex] === undefined)) return null;
                    // Convert speed and direction into wind vector
                    return toWindComponents(speed, direction);
                })
            });
        }
        // Issue an error if there are no usable samples after deduplication 
        if (!samplesByCell.size) throw new Error('Open-Meteo returned no usable wind samples');
        // Replace the previous grid with the newly parsed unique model-cell samples
        this.samples = Array.from(samplesByCell.values());
        // Record when this complete weather grid was downloaded
        this.updatedAt = Date.now();
        console.log('Loaded shared wind grid', {
            // Report how many geographic points were sent in the request
            requestedPoints: this.queryPoints.length,
            // Report how many location entries Open-Meteo returned
            returnedEntries: entries.length,
            // Report how many response entries contained valid hourly arrays
            usableEntries: usableEntries,
            // Report how many usable entries shared a cell key with an earlier entry
            duplicateCells: duplicateCells,
            // Report how many unique model cells are available for interpolation
            samples: this.samples.length
        });
    };

    // Fetch the weather grid once, sharing an in-progress request with any other caller
    WeatherManager.prototype.update = function () {
        // Return existing promise rather than starting a duplicate request
        if (this._pending) return this._pending;
        // Format all requested latitudes and longitudes as comma-separated decimal strings
        const latitudes = this.queryPoints.map(function (point) { return point.latitude.toFixed(5); }).join(',');
        const longitudes = this.queryPoints.map(function (point) { return point.longitude.toFixed(5); }).join(',');
        // Define the API URL
        const url = 'https://api.open-meteo.com/v1/ecmwf' + '?latitude=' + encodeURIComponent(latitudes) +
            '&longitude=' + encodeURIComponent(longitudes) + '&hourly=wind_speed_10m,wind_direction_10m' +
            '&wind_speed_unit=ms' + '&timeformat=unixtime' +
            // Use UTC so data times do not depend on the visitor's local timezone
            '&timezone=UTC' +
            // Include one past and 48 future hours so current timestamp can be interpolated when possible
            '&past_hours=1' + '&forecast_hours=' + 48 +
            // Let Open-Meteo select the nearest available model cell for each coordinate
            '&cell_selection=nearest' +
            // Select native 9 km IFS HRES model
            '&models=ecmwf_ifs';
        // Send the request to Open-Meteo and store the resulting promise so other callers can share it
        this._pending = fetch(url)
            .then(function (response) {
                // Issue an error if HTTP request failed, which will be caught by following catch ()
                if (!response.ok) throw new Error('Open-Meteo request failed: ' + response.status);
                // Parse a successful response body as JSON
                return response.json();
            })
            // Convert the API response into the manager's internal sample grid format
            .then((data) => {
                this._applyApi(data);
                return { success: true };
            })
            .catch(function (error) {
                // Issue an error when fetched data or processing fails
                console.error('Weather grid update failed', error);
                return { success: false, error: error };
            })
            // Schedule clearing the pending promise after the request has finished
            .then((result) => {
                this._pending = null;
                return result;
            });
        // Return the shared promise so callers can wait for the same weather update 
        return this._pending;
    };

    // Estimate the wind vector at any supported coordinate and timestamp
    WeatherManager.prototype.getWindAt = function (latitude, longitude, timestamp) {
        // Reject invalid coordinate or time inputs 
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(timestamp)) return null;
        // Do not extrapolate to coordinates beyond the territory bounds
        if (latitude < this.bounds.minLatitude || latitude > this.bounds.maxLatitude ||
            longitude < this.bounds.minLongitude || longitude > this.bounds.maxLongitude) return null;
        // Create an empty array to hold the closest four samples with usable wind data
        const nearest = [];
        // Check every available weather sample 
        for (let i = 0; i < this.samples.length; i++) {
            // Get the current sample
            const sample = this.samples[i];
            // Get its exact or time-interpolated wind vector for requested timestamp
            const vector = getTimedVector(sample, timestamp);
            // Skip current iteration if it has no usable wind vector
            if (!vector) continue;
            // Calculate geographic distance between current weather sample and requested coordinate 
            const distance = distanceMeters(latitude, longitude, sample);
            // Assume current sample comes after all existing samples
            let insertionIndex = nearest.length;
            // Move the insertion point left while previous samples are farther away than current sample
            while (insertionIndex > 0 && nearest[insertionIndex - 1].distance > distance) insertionIndex--;
            // Keep current sample only if it belongs among the four closest valid cells
            if (insertionIndex < 4) {
                // Insert current sample in nearest-first order
                nearest.splice(insertionIndex, 0, { distance: distance, vector: vector });
                // Remove the farthest entry if insertion made the list longer than four
                if (nearest.length > 4) nearest.pop();
            }
        }
        // Return no wind if there are no valid nearest samples
        if (!nearest.length) return null;
        // If the closest sample is less than one metre away, return its vector without interpolation 
        // To avoid numerical instability from dividing by a very small distance
        if (nearest[0].distance < SAME_LOCATION_THRESHOLD_METERS) {
            return { east: nearest[0].vector.east, north: nearest[0].vector.north };
        }
        // Initialize totals used to calculate the weighted average of nearby vectors
        let totalWeight = 0;
        let east = 0;
        let north = 0;
        // Calculate weighted average of the closest four samples
        for (let i = 0; i < nearest.length; i++) {
            // Give closer samples more influence by using the inverse square of distance
            const weight = 1 / (nearest[i].distance * nearest[i].distance);
            totalWeight += weight;
            east += nearest[i].vector.east * weight;
            north += nearest[i].vector.north * weight;
        }
        return { east: east / totalWeight, north: north / totalWeight };
    };

    // Fetch the weather grid and wait for its result
    WeatherManager.prototype.start = async function () {
        // Return the existing promise if the initial weather-grid request is already in progress
        if (this._startPromise) return await this._startPromise;
        // Start the initial weather-grid request and store its promise so other callers can share it
        this._startPromise = this.update();
        // Return the shared promise so other callers can wait for the same weather update
        return await this._startPromise;
    };
    // Expose the constructor so the main app can create a weather manager instance
    return WeatherManager;
}());
