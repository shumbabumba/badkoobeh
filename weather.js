// UPDATE
var WeatherManager = (function () {
    var SPEED_TO_PX = 1.0; // convertion from wind speed to visual pixels/sec
    var REFRESH = 15 * 60 * 1000; // refreshing every 15 minutes

    // Create a vector based on wind speed and direction
    function Vector(windSpeed, windDirection) {
        // Distinguish between wind direction and blowing diection
        var blowingTo = (windDirection + 180) * Math.PI / 180.0;
        var vx = Math.sin(blowingTo) * windSpeed * SPEED_TO_PX; // pixels/sec
        var vy = -Math.cos(blowingTo) * windSpeed * SPEED_TO_PX; // negative because screen y grows downward
        return { x: vx, y: vy };
    }

    // WeatherManager constructor function that takes lat/lon and a callback for updates
    function WeatherManager(lat, lon, onUpdate) {
        this.lat = lat;
        this.lon = lon;
        this.onUpdate = onUpdate;
        this.current = {
            vector: { x: 0, y: 0 },
            windSpeed: 0,
            windDirection: 0,
            precipitation: 0,
            relativeHumidity: 0,
            temperature: 0
        };
        // continue 
        this._stopped = false;
    }

    WeatherManager.prototype._applyApi = function (data) {
        var currentWeather = data.current_weather || {};
        var windSpeed = currentWeather.windspeed || 0; // usually km/h
        var windDirection = currentWeather.winddirection || 0; // degrees
        var precipitation = currentWeather.precipitation || 0; // mm
        var relativeHumidity = currentWeather.relative_humidity || 0; // %
        var temperature = currentWeather.temperature || 0; // °C
        var vector = Vector(windSpeed, windDirection);
        this.current = {
            vector: vector,
            windSpeed: windSpeed,
            windDirection: windDirection,
            precipitation: precipitation,
            relativeHumidity: relativeHumidity,
            temperature: temperature
        };
        if (typeof this.onUpdate === 'function') this.onUpdate(this.current);
    };

    WeatherManager.prototype.update = function () {
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(this.lat) + '&longitude=' + encodeURIComponent(this.lon) + '&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,relative_humidity_2m' + '&wind_speed_unit=ms' + '&timezone=auto';
        fetch(url).then(function (r) { return r.json(); }).then((data) => {
            this._applyApi(data);
        }).catch(function (err) {
            console.error('Weather fetch error', err);
        });
    };

    WeatherManager.prototype.start = function () {
        var self = this;
        this.update();
        this._interval = setInterval(function () { self.update(); }, REFRESH);
    };

    return WeatherManager;
}());