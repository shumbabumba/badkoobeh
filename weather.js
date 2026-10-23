// Define the shared wind-data service, which fetches one grid for all fragments.
const WeatherManager = (function () {
    // Use Open-Meteo's ECMWF endpoint as the weather-data source.
    const API_URL = 'https://api.open-meteo.com/v1/ecmwf';
    // Set the requested spacing between geographic weather sample points to nine kilometres.
    const MODEL_GRID_SPACING_METERS = 9000;
    // Use Earth's average radius when estimating distances between nearby coordinates.
    const EARTH_RADIUS_METERS = 6371000;
    // Refresh the shared weather grid every fifteen minutes.
    const REFRESH_INTERVAL = 15 * 60 * 1000;
    // Request the next forty-eight hours of hourly forecast values.
    const FORECAST_HOURS = 48;

    // Build the geographic sample-point grid covering and padding the map territory.
    function buildGrid(territoryBounds) {
        // Read the southwest corner of the map's geographic bounds.
        const southWest = territoryBounds.getSouthWest();
        // Read the northeast corner of the map's geographic bounds.
        const northEast = territoryBounds.getNorthEast();
        // Convert the requested nine-kilometre spacing into approximate degrees of latitude.
        const latitudeStep = MODEL_GRID_SPACING_METERS / 111320;
        // Estimate the territory's middle latitude for longitude-distance conversion.
        const middleLatitude = (southWest.lat + northEast.lat) / 2;
        // Convert nine kilometres into approximate degrees of longitude at the middle latitude.
        const longitudeStep = MODEL_GRID_SPACING_METERS /
            (111320 * Math.cos(middleLatitude * Math.PI / 180));
        // Create the array that will hold every requested latitude-longitude point.
        const points = [];
        // Extend the grid one latitude step below the territory so edge fragments have nearby samples.
        const minLatitude = southWest.lat - latitudeStep;
        // Extend the grid one latitude step above the territory so edge fragments have nearby samples.
        const maxLatitude = northEast.lat + latitudeStep;
        // Extend the grid one longitude step west of the territory for edge coverage.
        const minLongitude = southWest.lng - longitudeStep;
        // Extend the grid one longitude step east of the territory for edge coverage.
        const maxLongitude = northEast.lng + longitudeStep;

        // Visit each latitude row, including a small tolerance for the final step.
        for (let latitude = minLatitude; latitude <= maxLatitude + latitudeStep / 2; latitude += latitudeStep) {
            // Visit each longitude position in the current latitude row.
            for (let longitude = minLongitude; longitude <= maxLongitude + longitudeStep / 2; longitude += longitudeStep) {
                // Add the current grid coordinate to the list of Open-Meteo requests.
                points.push({ latitude: latitude, longitude: longitude });
            // End the loop over longitudes for this row.
            }
        // End the loop over latitude rows.
        }

        // Return both the requested points and their outermost coordinate bounds.
        return {
            // Make all generated sample coordinates available to the weather manager.
            points: points,
            // Store coordinate limits used later to reject locations outside the grid.
            bounds: {
                // Use the first generated point's latitude as the grid's lower bound.
                minLatitude: points[0].latitude,
                // Use the last generated point's latitude as the grid's upper bound.
                maxLatitude: points[points.length - 1].latitude,
                // Use the first generated point's longitude as the grid's western bound.
                minLongitude: points[0].longitude,
                // Use the last generated point's longitude as the grid's eastern bound.
                maxLongitude: points[points.length - 1].longitude
            // Finish the grid bounds object.
            }
        // Finish the returned grid object.
        };
    // End the grid-building helper.
    }

    // Convert a wind speed and meteorological direction into eastward and northward components.
    function toWindComponents(speed, direction) {
        // Reject missing, non-numeric, or physically invalid negative wind speeds.
        if (!Number.isFinite(speed) || speed < 0) return null;
        // Represent calm wind as a valid vector with no eastward or northward movement.
        if (speed === 0) return { east: 0, north: 0 };
        // Reject a non-numeric direction when a nonzero speed needs an orientation.
        if (!Number.isFinite(direction)) return null;

        // Open-Meteo reports the direction wind comes from, so the resulting components point where it blows toward.
        // Convert the compass bearing from degrees to radians for JavaScript's trigonometric functions.
        const radians = direction * Math.PI / 180;
        // Return signed east-west and north-south wind speeds, both measured in metres per second.
        return {
            // A negative sine accounts for meteorological bearings pointing from the wind's source.
            east: -speed * Math.sin(radians),
            // A negative cosine accounts for meteorological bearings pointing from the wind's source.
            north: -speed * Math.cos(radians)
        // Finish the vector returned to the caller.
        };
    // End wind-direction conversion.
    }

    // Find or interpolate one sample's wind vector at the requested time.
    function getTimedVector(sample, timestamp) {
        // Read the array of timestamps associated with this weather sample.
        const times = sample.times;
        // Return no estimate if the sample has no times or the request is outside its available range.
        if (!times.length || timestamp < times[0] || timestamp > times[times.length - 1]) return null;

        // Start the lower edge of a binary search at the first hourly value.
        let low = 0;
        // Start the upper edge of the search at the final hourly value.
        let high = times.length - 1;
        // Search the sorted timestamps until an exact match or the surrounding pair is found.
        while (low <= high) {
            // Choose the middle index of the remaining search range.
            const middle = Math.floor((low + high) / 2);
            // Check whether the middle weather value exactly matches the requested time.
            if (times[middle] === timestamp) {
                // Read the vector stored for this exact time.
                const exact = sample.vectors[middle];
                // Return a copy of the exact vector, or null if its data is missing.
                return exact ? { east: exact.east, north: exact.north } : null;
            // If the middle time is earlier than requested, continue searching the upper half.
            }
            if (times[middle] < timestamp) low = middle + 1;
            // Otherwise, continue searching the lower half of the time array.
            else high = middle - 1;
        // End the binary search after an exact value or insertion point is found.
        }

        // The last index below the requested time is the earlier interpolation sample.
        const beforeIndex = high;
        // The first index above the requested time is the later interpolation sample.
        const afterIndex = low;
        // Read the vector from the earlier time.
        const before = sample.vectors[beforeIndex];
        // Read the vector from the later time.
        const after = sample.vectors[afterIndex];
        // Refuse interpolation if either neighboring time has missing wind data.
        if (!before || !after) return null;

        // Calculate the requested time's fractional position between the two samples.
        const ratio = (timestamp - times[beforeIndex]) /
            (times[afterIndex] - times[beforeIndex]);
        // Interpolate each vector component separately so compass angles are never averaged directly.
        return {
            // Blend the eastward values according to how close the requested time is to each sample.
            east: before.east + (after.east - before.east) * ratio,
            // Blend the northward values according to how close the requested time is to each sample.
            north: before.north + (after.north - before.north) * ratio
        // Finish the interpolated wind vector.
        };
    // End the time-interpolation helper.
    }

    // Estimate straight-line distance in metres between a coordinate and a weather sample.
    function distanceMeters(latitude, longitude, sample) {
        // Find the average latitude and convert it to radians for longitude-distance scaling.
        const middleLatitude = (latitude + sample.latitude) / 2 * Math.PI / 180;
        // Approximate east-west separation, accounting for longitude lines narrowing toward the poles.
        const east = (sample.longitude - longitude) * Math.PI / 180 *
            EARTH_RADIUS_METERS * Math.cos(middleLatitude);
        // Approximate north-south separation using Earth's radius and latitude difference.
        const north = (sample.latitude - latitude) * Math.PI / 180 * EARTH_RADIUS_METERS;
        // Combine the perpendicular east and north distances with the Pythagorean theorem.
        return Math.sqrt(east * east + north * north);
    // End the geographic distance helper.
    }

    // Estimate how far valid returned sample cells cover around the requested grid.
    function getCoverageRadiusMeters(samples) {
        // Collect unique sample latitudes and sort them from south to north.
        const latitudes = Array.from(new Set(samples.map(function (sample) { return sample.latitude; }))).sort(function (a, b) { return a - b; });
        // Collect unique sample longitudes and sort them from west to east.
        const longitudes = Array.from(new Set(samples.map(function (sample) { return sample.longitude; }))).sort(function (a, b) { return a - b; });
        // Calculate the average sample latitude and convert it to radians.
        const middleLatitude = samples.reduce(function (sum, sample) { return sum + sample.latitude; }, 0) /
            samples.length * Math.PI / 180;

        // Find the largest gap between sorted coordinates and convert it into metres.
        function largestGapMeters(values, metersPerDegree) {
            // Begin with no measured gap between samples.
            let largestGap = 0;
            // Compare each coordinate with the one immediately before it.
            for (let i = 1; i < values.length; i++) {
                // Keep the largest coordinate gap seen so far, expressed in metres.
                largestGap = Math.max(largestGap, (values[i] - values[i - 1]) * metersPerDegree);
            // End the comparison of adjacent coordinates.
            }
            // Use the measured largest gap, or the requested model spacing if there is only one coordinate.
            return largestGap || MODEL_GRID_SPACING_METERS;
        // End the largest-gap helper.
        }

        // Open-Meteo may return snapped model cells that are farther apart than the requested points.
        // Base the valid search radius on the actual spacing of those returned cells.
        const latitudeSpacing = largestGapMeters(latitudes, 111320);
        // Convert longitude gaps using the average latitude because longitude distances vary by latitude.
        const longitudeSpacing = largestGapMeters(longitudes, 111320 * Math.cos(middleLatitude));
        // Return half the diagonal formed by the largest latitude and longitude sample gaps.
        return Math.sqrt(latitudeSpacing * latitudeSpacing + longitudeSpacing * longitudeSpacing) / 2;
    // End the coverage-radius helper.
    }

    // Define one weather manager that owns the shared grid and its refresh timer.
    function WeatherManager(territoryBounds) {
        // Build the requested grid and padded bounds for the map territory.
        const grid = buildGrid(territoryBounds);
        // Keep the requested coordinate points used to construct each API request.
        this.queryPoints = grid.points;
        // Keep the outer bounds used to reject lookups outside the padded grid.
        this.bounds = grid.bounds;
        // Start without any downloaded or usable wind samples.
        this.samples = [];
        // Set an initial maximum distance for samples until returned-cell spacing is known.
        this.maxInterpolationDistance = MODEL_GRID_SPACING_METERS * 1.5;
        // Track the current network request so duplicate updates can share it.
        this._pending = null;
        // Store the periodic refresh timer once the manager starts.
        this._interval = null;
    // End the WeatherManager constructor.
    }

    // Convert an Open-Meteo response into the manager's deduplicated sample format.
    WeatherManager.prototype._applyApi = function (response) {
        // Normalize one result or multiple results into an array for common processing.
        const entries = Array.isArray(response) ? response : [response];
        // Check that Open-Meteo returned one entry for each requested grid coordinate.
        if (entries.length !== this.queryPoints.length) {
            // Report a malformed response rather than pairing data with the wrong requested locations.
            throw new Error('Open-Meteo returned an unexpected number of weather-grid points');
        // End the response-size validation.
        }

        // Use a map to keep only one sample for each returned model-cell coordinate.
        const samplesByCell = new Map();
        // Process each weather response entry alongside its requested coordinate.
        for (let i = 0; i < entries.length; i++) {
            // Use an empty object if an individual response entry is unexpectedly missing.
            const entry = entries[i] || {};
            // Read the hourly forecast section, or an empty object if it was omitted.
            const hourly = entry.hourly || {};
            // Convert each Unix timestamp from seconds to JavaScript milliseconds.
            const times = Array.isArray(hourly.time)
                // Convert the provided timestamp list into millisecond numbers.
                ? hourly.time.map(function (value) { return Number(value) * 1000; })
                // Use an empty array when the hourly time list is missing or malformed.
                : [];
            // Read the hourly ten-metre wind-speed values.
            const speeds = hourly.wind_speed_10m || [];
            // Read the hourly ten-metre wind-direction values.
            const directions = hourly.wind_direction_10m || [];
            // Skip this entry unless its times and paired wind arrays are complete and numeric.
            if (!times.length || times.some(function (time) { return !Number.isFinite(time); }) ||
                speeds.length !== times.length || directions.length !== times.length) continue;

            // Use the model's returned latitude when valid, otherwise use the requested latitude.
            const latitude = entry.latitude !== null && entry.latitude !== undefined && Number.isFinite(Number(entry.latitude))
                // Convert a valid returned latitude into a number.
                ? Number(entry.latitude) : this.queryPoints[i].latitude;
            // Use the model's returned longitude when valid, otherwise use the requested longitude.
            const longitude = entry.longitude !== null && entry.longitude !== undefined && Number.isFinite(Number(entry.longitude))
                // Convert a valid returned longitude into a number.
                ? Number(entry.longitude) : this.queryPoints[i].longitude;
            // Build a stable key from the returned coordinates to detect duplicate model cells.
            const cellKey = latitude.toFixed(4) + ',' + longitude.toFixed(4);
            // Skip an entry when an earlier requested point already resolved to this same model cell.
            if (samplesByCell.has(cellKey)) continue;

            // Store the unique cell's position, time axis, and converted wind vectors.
            samplesByCell.set(cellKey, {
                // Save the actual or fallback latitude associated with this weather cell.
                latitude: latitude,
                // Save the actual or fallback longitude associated with this weather cell.
                longitude: longitude,
                // Save the hourly timestamps used to find or interpolate wind in time.
                times: times,
                // Convert each hourly speed and direction into an east-north vector or null.
                vectors: times.map(function (_, timeIndex) {
                    // Read the speed value for this hour and convert it to a number.
                    const speed = Number(speeds[timeIndex]);
                    // Read the direction value for this hour and convert it to a number.
                    const direction = Number(directions[timeIndex]);
                    // Preserve a missing speed as missing data instead of converting null to zero.
                    if (speeds[timeIndex] === null || speeds[timeIndex] === undefined) return null;
                    // Preserve missing direction data unless the speed is calm and direction is irrelevant.
                    if (speed !== 0 && (directions[timeIndex] === null || directions[timeIndex] === undefined)) return null;
                    // Convert the hourly values into eastward and northward wind components.
                    return toWindComponents(speed, direction);
                // End conversion of this cell's hourly values.
                })
            // Finish the unique sample object.
            });
        // End processing of all returned weather entries.
        }

        // Fail the update if no response entry contained a usable hourly wind series.
        if (!samplesByCell.size) throw new Error('Open-Meteo returned no usable wind samples');
        // Replace the previous grid with the newly parsed unique model-cell samples.
        this.samples = Array.from(samplesByCell.values());
        // Set lookup coverage using spacing among the cells Open-Meteo actually returned.
        this.maxInterpolationDistance = getCoverageRadiusMeters(this.samples);
        // Record when this complete weather grid was downloaded.
        this.updatedAt = Date.now();
        // Report grid count, requested spacing, actual coverage, and source time resolution.
        console.log('Loaded shared wind grid', {
            // Report how many unique model cells are available for interpolation.
            samples: this.samples.length,
            // Report the requested spacing between coordinates sent to the API.
            requestedGridSpacingMeters: MODEL_GRID_SPACING_METERS,
            // Report the estimated maximum interpolation coverage in rounded metres.
            interpolationCoverageRadiusMeters: Math.round(this.maxInterpolationDistance),
            // Report the hourly source data's temporal spacing in minutes.
            temporalResolutionMinutes: 60
        // Finish the grid-loading diagnostic details.
        });
    // End conversion of the API response.
    };

    // Fetch the weather grid once, sharing an in-progress request with any other caller.
    WeatherManager.prototype.update = function () {
        // Return the existing promise rather than starting a duplicate request.
        if (this._pending) return this._pending;

        // Format all requested latitudes as comma-separated decimal strings.
        const latitudes = this.queryPoints.map(function (point) { return point.latitude.toFixed(5); }).join(',');
        // Format all requested longitudes as comma-separated decimal strings.
        const longitudes = this.queryPoints.map(function (point) { return point.longitude.toFixed(5); }).join(',');
        // Begin the API URL with the endpoint and encoded coordinate lists.
        const url = API_URL + '?latitude=' + encodeURIComponent(latitudes) +
            // Add the longitude list so the API requests the same set of sample points.
            '&longitude=' + encodeURIComponent(longitudes) +
            // Request hourly wind speed and direction at ten metres above ground.
            '&hourly=wind_speed_10m,wind_direction_10m' +
            // Ask Open-Meteo to express speed in metres per second.
            '&wind_speed_unit=ms' +
            // Ask for Unix timestamps to make date conversion explicit and consistent.
            '&timeformat=unixtime' +
            // Use UTC so data times do not depend on the visitor's local timezone.
            '&timezone=UTC' +
            // Include one past hour so a current timestamp can be interpolated when possible.
            '&past_hours=1' +
            // Request the configured number of future forecast hours.
            '&forecast_hours=' + FORECAST_HOURS +
            // Let Open-Meteo select the nearest available model cell for each coordinate.
            '&cell_selection=nearest';

        // Save the complete request chain so later callers can reuse it until it finishes.
        this._pending = fetch(url)
            // Check for HTTP failure before attempting to parse the response body.
            .then(function (response) {
                // Reject unsuccessful responses with their HTTP status code.
                if (!response.ok) throw new Error('Open-Meteo request failed: ' + response.status);
                // Parse a successful response body as JSON.
                return response.json();
            // Pass the parsed response to this manager's grid parser.
            })
            .then((data) => this._applyApi(data))
            // Keep the previous complete grid if this network refresh fails.
            .catch(function (error) {
                // Report the failed update so the problem is visible during debugging.
                console.error('Weather grid update failed', error);
            // End the request error handler.
            })
            // Clear the pending-request marker after either success or failure.
            .then(() => { this._pending = null; });

        // Return the promise so callers can wait until this update attempt has finished.
        return this._pending;
    // End the shared weather update method.
    };

    // Estimate the wind vector at any supported coordinate and timestamp.
    WeatherManager.prototype.getWindAt = function (latitude, longitude, timestamp) {
        // Reject invalid coordinate or time inputs before searching the weather grid.
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(timestamp)) return null;
        // Do not extrapolate to coordinates beyond the padded grid's outer bounds.
        if (latitude < this.bounds.minLatitude || latitude > this.bounds.maxLatitude ||
            longitude < this.bounds.minLongitude || longitude > this.bounds.maxLongitude) return null;

        // Create a short ordered list of the nearest valid weather samples.
        const nearest = [];
        // Check every available model-cell sample for usable time and distance data.
        for (let i = 0; i < this.samples.length; i++) {
            // Read the model-cell sample currently being considered.
            const sample = this.samples[i];
            // Get its exact or time-interpolated wind vector for the requested timestamp.
            const vector = getTimedVector(sample, timestamp);
            // Skip this sample if it has no usable wind vector at the requested time.
            if (!vector) continue;
            // Calculate the geographic distance from the requested point to this sample cell.
            const distance = distanceMeters(latitude, longitude, sample);
            // Skip samples outside the grid's current interpolation coverage radius.
            if (distance > this.maxInterpolationDistance) continue;

            // Begin by inserting this sample after all existing samples.
            let insertionIndex = nearest.length;
            // Move the insertion point left while existing samples are farther away.
            while (insertionIndex > 0 && nearest[insertionIndex - 1].distance > distance) insertionIndex--;
            // Keep this sample only if it belongs among the four closest valid cells.
            if (insertionIndex < 4) {
                // Insert the sample and its distance in nearest-first order.
                nearest.splice(insertionIndex, 0, { distance: distance, vector: vector });
                // Remove the farthest entry if insertion made the list longer than four.
                if (nearest.length > 4) nearest.pop();
            // End the nearest-four insertion condition.
            }
        // End the scan through the shared sample grid.
        }

        // Return no wind when time, coverage, or missing-data checks found no valid sample.
        if (!nearest.length) return null;
        // Return an almost exact sample directly to avoid unstable weights near zero distance.
        if (nearest[0].distance < 1) {
            // Copy the closest sample's east and north components into the result.
            return { east: nearest[0].vector.east, north: nearest[0].vector.north };
        // End the direct-nearest-sample condition.
        }

        // Explain that this calculation blends model cells into a location estimate.
        // The interpolation creates continuity but cannot create new meteorological detail.
        // Start totals used to calculate the weighted average of nearby vectors.
        let totalWeight = 0;
        // Start the accumulated eastward component at zero.
        let east = 0;
        // Start the accumulated northward component at zero.
        let north = 0;
        // Add each of the nearest samples to the inverse-distance weighted totals.
        for (let i = 0; i < nearest.length; i++) {
            // Give closer samples more influence by using the inverse square of distance.
            const weight = 1 / (nearest[i].distance * nearest[i].distance);
            // Add this sample's weight to the normalization total.
            totalWeight += weight;
            // Add its weighted eastward component to the running total.
            east += nearest[i].vector.east * weight;
            // Add its weighted northward component to the running total.
            north += nearest[i].vector.north * weight;
        // End accumulation across the nearest samples.
        }
        // Normalize both weighted component totals and return the estimated local wind vector.
        return { east: east / totalWeight, north: north / totalWeight };
    // End the location-specific weather lookup method.
    };

    // Start an immediate fetch and set up recurring shared-grid refreshes.
    WeatherManager.prototype.start = function () {
        // Do nothing when this manager already has a refresh timer running.
        if (this._interval) return;
        // Fetch the first grid immediately instead of waiting for the timer.
        this.update();
        // Schedule a future shared-grid update at the configured refresh interval.
        this._interval = setInterval(() => this.update(), REFRESH_INTERVAL);
    // End the weather manager start method.
    };

    // Stop future automatic weather refreshes.
    WeatherManager.prototype.stop = function () {
        // Clear the timer when one was previously created.
        if (this._interval) clearInterval(this._interval);
        // Reset the timer field so start() can be called again later.
        this._interval = null;
    // End the weather manager stop method.
    };

    // Expose the constructor so the main app can create a weather manager instance.
    return WeatherManager;
// End the wrapper that keeps helper functions and constants private.
}());
