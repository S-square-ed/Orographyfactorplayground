var map;
var marker;

document.addEventListener('DOMContentLoaded', function () {
    setupProj4();
    setupInputTypeUI();
    initializeMap();
    calculate(); // initial calculation
});

/* --------------------------
   UI: input type panels
-------------------------- */
function setupInputTypeUI() {
    var inputType = document.getElementById('inputType');
    inputType.addEventListener('change', updateInputPanels);
    updateInputPanels();
}

function updateInputPanels() {
    var type = document.getElementById('inputType').value;

    document.getElementById('panelAddress').classList.toggle('hidden', type !== 'address');
    document.getElementById('panelLonLat').classList.toggle('hidden', type !== 'lonlat');

    var isLambert = (type === 'lambert72' || type === 'lambert2008');
    document.getElementById('panelLambert').classList.toggle('hidden', !isLambert);

    var lambertLabel = document.getElementById('lambert_input_label');
    if (lambertLabel) {
        lambertLabel.textContent = (type === 'lambert2008') ? 'Lambert 2008' : 'Lambert 72';
    }
}

/* --------------------------
   Proj4: CRS definitions
-------------------------- */
function setupProj4() {
    if (typeof proj4 === 'undefined') {
        console.warn('Proj4js not loaded. Lambert conversion will not work.');
        return;
    }

    // WGS84
    proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");

    // Belgian Lambert 72 (EPSG:31370)
    proj4.defs(
        "EPSG:31370",
        "+proj=lcc +lat_0=90 +lon_0=4.36748666666667 +lat_1=51.1666672333333 +lat_2=49.8333339 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs +type=crs"
    );

    // Belgian Lambert 2008 (EPSG:3812)
    proj4.defs(
        "EPSG:3812",
        "+proj=lcc +lat_0=50.797815 +lon_0=4.35921583333333 +lat_1=49.8333333333333 +lat_2=51.1666666666667 +x_0=649328 +y_0=665262 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs"
    );
}

function wgs84ToLambert(latitude, longitude, crs) {
    var out = proj4("EPSG:4326", crs, [longitude, latitude]);
    return { x: out[0], y: out[1], crs: crs };
}

function lambertToWgs84(x, y, crs) {
    var out = proj4(crs, "EPSG:4326", [x, y]);
    return { longitude: out[0], latitude: out[1] };
}

function setTextIfExists(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
}

/* --------------------------
   MAIN: calculate (4 modes)
-------------------------- */
function calculate() {
    var inputType = document.getElementById('inputType').value;

    if (inputType === 'address') {
        calculateFromAddress();
        return;
    }

    if (inputType === 'lonlat') {
        calculateFromLonLat();
        return;
    }

    if (inputType === 'lambert72') {
        calculateFromLambert("EPSG:31370");
        return;
    }

    if (inputType === 'lambert2008') {
        calculateFromLambert("EPSG:3812");
        return;
    }
}

function calculateFromAddress() {
    var addressInput = document.getElementById('address').value;
    if (!addressInput || !addressInput.trim()) {
        alert('Please enter an address.');
        return;
    }

    var url = 'https://nominatim.openstreetmap.org/search?q='
        + encodeURIComponent(addressInput)
        + '&format=json&addressdetails=1';

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                var latitude = parseFloat(data[0].lat);
                var longitude = parseFloat(data[0].lon);

                applyResolvedCoordinates(latitude, longitude, null);
            } else {
                alert('Your address is not correct. Please try again.');
            }
        })
        .catch(error => console.error('Error:', error));
}

function calculateFromLonLat() {
    var lonStr = document.getElementById('lon_input').value;
    var latStr = document.getElementById('lat_input').value;

    var longitude = parseFloat(String(lonStr).replace(',', '.'));
    var latitude = parseFloat(String(latStr).replace(',', '.'));

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        alert('Please enter valid longitude and latitude.');
        return;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        alert('Longitude/Latitude out of range.');
        return;
    }

    applyResolvedCoordinates(latitude, longitude, null);
}

function calculateFromLambert(crs) {
    if (typeof proj4 === 'undefined') {
        alert('Lambert conversion is unavailable (Proj4js not loaded).');
        return;
    }

    var xStr = document.getElementById('lambert_x_input').value;
    var yStr = document.getElementById('lambert_y_input').value;

    var x = parseFloat(String(xStr).replace(',', '.'));
    var y = parseFloat(String(yStr).replace(',', '.'));

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        alert('Please enter valid Lambert X and Y.');
        return;
    }

    var wgs = lambertToWgs84(x, y, crs);

    // Keep the typed Lambert for display
    var lambertDisplay = { x: x, y: y, crs: crs };

    applyResolvedCoordinates(wgs.latitude, wgs.longitude, lambertDisplay);
}

/* --------------------------
   Apply coordinates (shared)
-------------------------- */
function applyResolvedCoordinates(latitude, longitude, lambertDisplay /* optional */) {
    // Update existing result spans
    setTextIfExists('latitude', latitude);
    setTextIfExists('longitude', longitude);

    // Update inline black display
    setTextIfExists('latitude_inline', Number.isFinite(latitude) ? latitude.toFixed(6) : '—');
    setTextIfExists('longitude_inline', Number.isFinite(longitude) ? longitude.toFixed(6) : '—');

    if (typeof proj4 !== 'undefined') {
        if (!lambertDisplay) {
            // Default display for address/lonlat: Lambert 72
            lambertDisplay = wgs84ToLambert(latitude, longitude, "EPSG:31370");
        }

        setTextIfExists('lambert_crs_inline',
            lambertDisplay.crs === "EPSG:3812" ? "Lambert 2008" : "Lambert 72"
        );
        setTextIfExists('lambert_x_inline', (Math.round(lambertDisplay.x * 1000) / 1000));
        setTextIfExists('lambert_y_inline', (Math.round(lambertDisplay.y * 1000) / 1000));
    } else {
        setTextIfExists('lambert_crs_inline', 'Lambert');
        setTextIfExists('lambert_x_inline', '—');
        setTextIfExists('lambert_y_inline', '—');
    }

    // Move marker and map
    if (marker && map) {
        marker.setLatLng([latitude, longitude]);
        map.setView([latitude, longitude]);
    }

    // Run the SAME workflow
    calculateElevation(latitude, longitude);
    calculateAllDirectons(latitude, longitude);
}

/* --------------------------
   Leaflet map
-------------------------- */
function initializeMap() {
    var initialLatitude = 50.8503;
    var initialLongitude = 4.3517;

    map = L.map('map').setView([initialLatitude, initialLongitude], 13);

    // HTTPS tiles (needed for GitHub Pages)
    var googleStreets = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });

    var googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });

    var googleSat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });

    var googleTerrain = L.tileLayer('https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });

    var baseMaps = {
        "Google Streets": googleStreets,
        "Google Hybrid": googleHybrid,
        "Google Satellite": googleSat,
        "Google Terrain": googleTerrain
    };

    googleTerrain.addTo(map);
    L.control.layers(baseMaps).addTo(map);

    marker = L.marker([initialLatitude, initialLongitude], { draggable: true }).addTo(map);

    var circle05km = L.circle([initialLatitude, initialLongitude], {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.05,
        weight: 1,
        radius: 500
    }).addTo(map);

    var circle1km = L.circle([initialLatitude, initialLongitude], {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.05,
        weight: 1,
        radius: 1000
    }).addTo(map);

    var crossSize = 1100;

    var verticalLine = L.polyline([
        [initialLatitude - crossSize / 111000, initialLongitude],
        [initialLatitude + crossSize / 111000, initialLongitude]
    ], {
        color: 'red',
        weight: 1,
    }).addTo(map);

    var horizontalLine = L.polyline([
        [initialLatitude, initialLongitude - crossSize / (111000 * Math.cos(initialLatitude * Math.PI / 180))],
        [initialLatitude, initialLongitude + crossSize / (111000 * Math.cos(initialLatitude * Math.PI / 180))]
    ], {
        color: 'red',
        weight: 1,
    }).addTo(map);

    marker.on('move', function (event) {
        var markerPosition = event.latlng;

        circle05km.setLatLng(markerPosition);
        circle1km.setLatLng(markerPosition);

        var newVerticalLineCoords = [
            [markerPosition.lat - crossSize / 111000, markerPosition.lng],
            [markerPosition.lat + crossSize / 111000, markerPosition.lng]
        ];

        var newHorizontalLineCoords = [
            [markerPosition.lat, markerPosition.lng - crossSize / (111000 * Math.cos(markerPosition.lat * Math.PI / 180))],
            [markerPosition.lat, markerPosition.lng + crossSize / (111000 * Math.cos(markerPosition.lat * Math.PI / 180))]
        ];

        verticalLine.setLatLngs(newVerticalLineCoords);
        horizontalLine.setLatLngs(newHorizontalLineCoords);
    });

    marker.on('dragend', function (event) {
        var markerPosition = event.target.getLatLng();
        applyResolvedCoordinates(markerPosition.lat, markerPosition.lng, null);
    });
}

/* --------------------------
   Elevation sampling
-------------------------- */
function calculateAllDirectons(latitude, longitude) {
    calculateElevationForDirection(latitude, longitude, 'north_05km', latitude + (0.5 / 111)); // 0.5 km north
    calculateElevationForDirection(latitude, longitude, 'south_05km', latitude - (0.5 / 111)); // 0.5 km south
    calculateElevationForDirection(latitude, longitude, 'east_05km', latitude, longitude + (0.5 / (111 * Math.cos(latitude * Math.PI / 180)))); // 0.5 km east
    calculateElevationForDirection(latitude, longitude, 'west_05km', latitude, longitude - (0.5 / (111 * Math.cos(latitude * Math.PI / 180)))); // 0.5 km west

    calculateElevationForDirection(latitude, longitude, 'north_1km', latitude + (1 / 111)); // 1 km north
    calculateElevationForDirection(latitude, longitude, 'south_1km', latitude - (1 / 111)); // 1 km south
    calculateElevationForDirection(latitude, longitude, 'east_1km', latitude, longitude + (1 / (111 * Math.cos(latitude * Math.PI / 180)))); // 1 km east
    calculateElevationForDirection(latitude, longitude, 'west_1km', latitude, longitude - (1 / (111 * Math.cos(latitude * Math.PI / 180)))); // 1 km west
}

function calculateElevationForDirection(latitude, longitude, direction, newLatitude = latitude, newLongitude = longitude) {
    const apiUrl = `https://api.open-meteo.com/v1/elevation?latitude=${newLatitude}&longitude=${newLongitude}`;

    fetch(apiUrl)
        .then(response => response.json())
        .then(data => {
            if (data.elevation && data.elevation.length > 0) {
                const elevation = data.elevation[0];
                document.getElementById(`elevation_${direction}`).textContent = `${elevation}`;
                calculateTotalElevation();
            } else {
                document.getElementById(`elevation_${direction}`).textContent = 'Data not available';
            }
        })
        .catch(error => console.error('Error:', error));
}

function calculateElevation(latitude, longitude) {
    const apiUrl = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`;

    fetch(apiUrl)
        .then(response => response.json())
        .then(data => {
            if (data.elevation && data.elevation.length > 0) {
                const elevation = data.elevation[0];
                document.getElementById('elevation').textContent = `${elevation}`;
                calculateTotalElevation();
            } else {
                document.getElementById('elevation').textContent = 'Data not available';
            }
        })
        .catch(error => console.error('Error:', error));
}

/* --------------------------
   ORIGINAL calculation logic
-------------------------- */
function calculateTotalElevation() {
    var elevationNorth05kmText = document.getElementById("elevation_north_05km").textContent;
    var elevationNorth1kmText = document.getElementById("elevation_north_1km").textContent;
    var elevationSouth05kmText = document.getElementById("elevation_south_05km").textContent;
    var elevationSouth1kmText = document.getElementById("elevation_south_1km").textContent;
    var elevationEast05kmText = document.getElementById("elevation_east_05km").textContent;
    var elevationEast1kmText = document.getElementById("elevation_east_1km").textContent;
    var elevationWest05kmText = document.getElementById("elevation_west_05km").textContent;
    var elevationWest1kmText = document.getElementById("elevation_west_1km").textContent;
    var elevationText = document.getElementById("elevation").textContent;

    var elevationNorth05km = parseFloat(elevationNorth05kmText.split(" ")[0]);
    var elevationNorth1km = parseFloat(elevationNorth1kmText.split(" ")[0]);
    var elevationSouth05km = parseFloat(elevationSouth05kmText.split(" ")[0]);
    var elevationSouth1km = parseFloat(elevationSouth1kmText.split(" ")[0]);
    var elevationEast05km = parseFloat(elevationEast05kmText.split(" ")[0]);
    var elevationEast1km = parseFloat(elevationEast1kmText.split(" ")[0]);
    var elevationWest05km = parseFloat(elevationWest05kmText.split(" ")[0]);
    var elevationWest1km = parseFloat(elevationWest1kmText.split(" ")[0]);
    var elevation = parseFloat(elevationText.split(" ")[0]);

    if (!Number.isFinite(elevation) ||
        !Number.isFinite(elevationNorth05km) || !Number.isFinite(elevationNorth1km) ||
        !Number.isFinite(elevationSouth05km) || !Number.isFinite(elevationSouth1km) ||
        !Number.isFinite(elevationEast05km) || !Number.isFinite(elevationEast1km) ||
        !Number.isFinite(elevationWest05km) || !Number.isFinite(elevationWest1km)
    ) {
        return;
    }

    var sum1km = elevationNorth1km + elevationSouth1km + elevationEast1km + elevationWest1km;
    var sum05km = elevationNorth05km + elevationSouth05km + elevationEast05km + elevationWest05km;

    var towerHeight = parseFloat(document.getElementById("height").value);

    var Am = 1 / 10 * (2 * elevation + sum1km + sum05km);
    var DeltaAc = elevation - Am;

    var OrographyFactor;
    if (towerHeight > 10) {
        OrographyFactor = 1 + 0.004 * DeltaAc * Math.exp(-0.014 * (towerHeight - 10));
    } else {
        OrographyFactor = 1 + 0.004 * DeltaAc * Math.exp(-0.014 * (10 - 10));
    }

    OrographyFactor = Math.ceil(OrographyFactor * 100) / 100;

    if (OrographyFactor <= 1.0) {
        document.getElementById("orography_factor_comment").textContent =
            "Site is considered flat. Standard pieces may be used";
    }
    else if (OrographyFactor > 1.15) {
        document.getElementById("orography_factor_comment").textContent =
            "Site is NOT flat. A detailed analysis is required. Standard pieces may not be used without an individual stability study.";
    }
    else if (OrographyFactor > 1.0 && OrographyFactor <= 1.15) {
        document.getElementById("orography_factor_comment").textContent =
            "Site is NOT flat. Standard pieces may not be used without an individual stability study.";
    }
    else {
        document.getElementById("orography_factor_comment").textContent = "";
    }

    document.getElementById("orography_factor").textContent = OrographyFactor.toFixed(2);
}
