/* Orography Factor Playground
   - Input modes: WGS84 lon/lat, address, Belgian Lambert (31370 or 3812)
   - Always displays both WGS84 and Lambert under the input area
   - Uses Open-Meteo geocoding + elevation APIs
   - Uses Proj4js for Lambert transforms

   Note: If you already had a different “orography factor” algorithm, you can swap
   computeOrographyFactorComplex() with your existing function and keep the rest.
*/

(function () {
  "use strict";

  // -----------------------------
  // DOM
  // -----------------------------
  const form = document.getElementById("locationForm");
  const inputType = document.getElementById("inputType");

  const panelLonLat = document.getElementById("panelLonLat");
  const panelAddress = document.getElementById("panelAddress");
  const panelLambert = document.getElementById("panelLambert");

  const lonEl = document.getElementById("lon");
  const latEl = document.getElementById("lat");

  const addressEl = document.getElementById("address");
  const countryCodeEl = document.getElementById("countryCode");

  const eastingEl = document.getElementById("easting");
  const northingEl = document.getElementById("northing");
  const lambertCrsEl = document.getElementById("lambertCrs");

  const zRefEl = document.getElementById("zRef");

  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");

  const statusEl = document.getElementById("status");

  const coordsLine1 = document.getElementById("coordsLine1");
  const coordsLine2 = document.getElementById("coordsLine2");

  const orographyFactorEl = document.getElementById("orography_factor");
  const AcEl = document.getElementById("Ac");
  const AmEl = document.getElementById("Am");

  const warningEl = document.getElementById("warning");

  const samplesTable = document.getElementById("samplesTable");
  const samplesTbody = samplesTable.querySelector("tbody");

  // -----------------------------
  // Proj4 defs (epsg.io)
  // -----------------------------
  function defineCrs() {
    // EPSG:31370 (Lambert 72)
    // From epsg.io "Proj4js" export
    proj4.defs(
      "EPSG:31370",
      "+proj=lcc +lat_0=90 +lon_0=4.36748666666667 +lat_1=51.1666672333333 +lat_2=49.8333339 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs +type=crs"
    );

    // EPSG:3812 (Lambert 2008)
    proj4.defs(
      "EPSG:3812",
      "+proj=lcc +lat_0=50.797815 +lon_0=4.35921583333333 +lat_1=49.8333333333333 +lat_2=51.1666666666667 +x_0=649328 +y_0=665262 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs"
    );

    // WGS84
    proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");
  }

  // -----------------------------
  // UI helpers
  // -----------------------------
  function setStatus(msg, kind = "info") {
    statusEl.className = `status ${kind}`;
    statusEl.textContent = msg || "";
  }

  function setLoading(isLoading) {
    runBtn.disabled = isLoading;
    inputType.disabled = isLoading;
    clearBtn.disabled = isLoading;
    form.querySelectorAll("input, select").forEach((el) => (el.disabled = isLoading && el !== clearBtn));
    if (!isLoading) {
      // re-enable everything after
      form.querySelectorAll("input, select, button").forEach((el) => (el.disabled = false));
      runBtn.disabled = false;
    }
  }

  function showPanel(type) {
    panelLonLat.classList.toggle("hidden", type !== "lonlat");
    panelAddress.classList.toggle("hidden", type !== "address");
    panelLambert.classList.toggle("hidden", type !== "lambert");
  }

  function clearOutputs() {
    coordsLine1.textContent = "—";
    coordsLine2.textContent = "—";
    orographyFactorEl.textContent = "—";
    AcEl.textContent = "—";
    AmEl.textContent = "—";
    warningEl.classList.add("hidden");
    warningEl.textContent = "";
    samplesTbody.innerHTML = "";
    setStatus("");
  }

  function clearInputs() {
    lonEl.value = "";
    latEl.value = "";
    addressEl.value = "";
    eastingEl.value = "";
    northingEl.value = "";
    countryCodeEl.value = "BE";
    lambertCrsEl.value = "auto";
    zRefEl.value = "10";
  }

  // -----------------------------
  // Parsing & validation
  // -----------------------------
  function toNumber(v) {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }

  function validateLonLat(lon, lat) {
    if (lon === null || lat === null) return "Longitude and latitude must be numbers.";
    if (lat < -90 || lat > 90) return "Latitude must be between -90 and 90.";
    if (lon < -180 || lon > 180) return "Longitude must be between -180 and 180.";
    return null;
  }

  function detectLambertCrs(northing) {
    // Heuristic:
    // - Lambert 72 northings are typically around 5,4 million.
    // - Lambert 2008 northings are typically around ~0,6–1,8 million.
    if (northing !== null && northing > 2_000_000) return "EPSG:31370";
    return "EPSG:3812";
  }

  // -----------------------------
  // Geocoding (Open-Meteo)
  // -----------------------------
  async function geocodeAddress(address, countryCode) {
    const name = address.trim();
    if (!name) throw new Error("Please enter an address.");

    const cc = (countryCode || "").trim().toUpperCase();
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", name);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    if (cc) url.searchParams.set("countryCode", cc);

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status}).`);
    const data = await res.json();

    if (!data || !data.results || !data.results.length) {
      throw new Error("No results found for that address.");
    }

    const r = data.results[0];
    return {
      lat: r.latitude,
      lon: r.longitude,
      label: [
        r.name,
        r.admin1 || "",
        r.country || ""
      ].filter(Boolean).join(", "),
    };
  }

  // -----------------------------
  // Elevation (Open-Meteo) - multiple points per request
  // -----------------------------
  async function fetchElevations(points) {
    // points: [{lat, lon, label, distanceM, bearingDeg}]
    const url = new URL("https://api.open-meteo.com/v1/elevation");
    url.searchParams.set("latitude", points.map((p) => p.lat).join(","));
    url.searchParams.set("longitude", points.map((p) => p.lon).join(","));

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`Elevation request failed (HTTP ${res.status}).`);
    const data = await res.json();
    if (!data || !Array.isArray(data.elevation) || data.elevation.length !== points.length) {
      throw new Error("Unexpected elevation response.");
    }

    return data.elevation.map((e) => (Number.isFinite(e) ? e : null));
  }

  // -----------------------------
  // Geodesy: destination point
  // -----------------------------
  function degToRad(d) {
    return (d * Math.PI) / 180;
  }
  function radToDeg(r) {
    return (r * 180) / Math.PI;
  }

  function destinationPoint(lat, lon, distanceM, bearingDeg) {
    // Great-circle destination (spherical Earth)
    const R = 6371e3;
    const φ1 = degToRad(lat);
    const λ1 = degToRad(lon);
    const θ = degToRad(bearingDeg);
    const δ = distanceM / R;

    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);

    const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
    const x = Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2);
    const λ2 = λ1 + Math.atan2(y, x);

    // normalize lon to -180..180
    let lon2 = radToDeg(λ2);
    lon2 = ((lon2 + 540) % 360) - 180;

    return { lat: radToDeg(φ2), lon: lon2 };
  }

  // -----------------------------
  // Coordinate conversions
  // -----------------------------
  function wgs84ToLambert(lon, lat, targetCrs = "EPSG:31370") {
    // proj4 expects [x, y] = [lon, lat] for EPSG:4326
    const [x, y] = proj4("EPSG:4326", targetCrs, [lon, lat]);
    return { x, y, crs: targetCrs };
  }

  function lambertToWgs84(x, y, sourceCrs) {
    const [lon, lat] = proj4(sourceCrs, "EPSG:4326", [x, y]);
    return { lon, lat };
  }

  function fmt(n, digits = 6) {
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(digits);
  }

  function fmtM(n) {
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(3);
  }

  function updateResolvedCoordinateDisplay({ lon, lat, lambertX, lambertY, lambertCrs, label }) {
    const labelPart = label ? ` (${label})` : "";
    coordsLine1.textContent = `WGS84: lon ${fmt(lon, 6)}, lat ${fmt(lat, 6)}${labelPart}`;
    coordsLine2.textContent = `${lambertCrs}: X ${fmtM(lambertX)} m, Y ${fmtM(lambertY)} m`;
  }

  // -----------------------------
  // Orography factor computation
  // -----------------------------
  async function computeOrographyFactorComplex(lon, lat, zRefMeters) {
    // “Complex orography” approach based on Ac (site elevation) and sampled elevations
    // at 500 m and 1000 m along 4 cardinal directions (N/E/S/W).
    // Am = (2*Ac + Σ(Ai,500 + Ai,1000)) / 10

    const bearings = [
      { name: "N", deg: 0 },
      { name: "E", deg: 90 },
      { name: "S", deg: 180 },
      { name: "W", deg: 270 },
    ];
    const distances = [500, 1000];

    const points = [];

    // Center first
    points.push({
      label: "CENTER",
      lat,
      lon,
      distanceM: 0,
      bearingDeg: null,
    });

    for (const b of bearings) {
      for (const d of distances) {
        const p = destinationPoint(lat, lon, d, b.deg);
        points.push({
          label: b.name,
          lat: p.lat,
          lon: p.lon,
          distanceM: d,
          bearingDeg: b.deg,
        });
      }
    }

    const elevations = await fetchElevations(points);

    const Ac = elevations[0];
    if (!Number.isFinite(Ac)) throw new Error("Could not determine site elevation.");

    // Sum of 8 samples (N/E/S/W at 500/1000)
    const sampleElevs = elevations.slice(1);
    if (sampleElevs.some((e) => !Number.isFinite(e))) throw new Error("Could not determine all sampled elevations.");

    const sumSamples = sampleElevs.reduce((acc, e) => acc + e, 0);
    const Am = (2 * Ac + sumSamples) / 10;

    const z = Math.max(0, Number.isFinite(zRefMeters) ? zRefMeters : 10);
    const attenuation = Math.exp(-0.014 * Math.max(0, z - 10));

    let c0 = 1 + 0.004 * (Ac - Am) * attenuation;

    // Conservative floor: factor should not reduce wind speed in this simplified approach
    if (c0 < 1) c0 = 1;

    return { c0, Ac, Am, points, elevations };
  }

  function renderSamples(points, elevations) {
    samplesTbody.innerHTML = "";
    points.forEach((p, idx) => {
      const tr = document.createElement("tr");

      const dist = p.distanceM === 0 ? "0 m" : `${p.distanceM} m`;
      const bearing = p.bearingDeg === null ? "—" : `${p.bearingDeg}°`;

      tr.innerHTML = `
        <td>${p.label}</td>
        <td>${dist}</td>
        <td>${bearing}</td>
        <td>${fmt(p.lat, 6)}</td>
        <td>${fmt(p.lon, 6)}</td>
        <td>${Number.isFinite(elevations[idx]) ? elevations[idx].toFixed(1) : "—"}</td>
      `;
      samplesTbody.appendChild(tr);
    });
  }

  // -----------------------------
  // Main runner
  // -----------------------------
  async function run() {
    setStatus("");
    warningEl.classList.add("hidden");
    warningEl.textContent = "";
    samplesTbody.innerHTML = "";

    const mode = inputType.value;
    const zRef = toNumber(zRefEl.value);
    if (zRef === null || zRef < 0) {
      throw new Error("Reference height z must be a non-negative number.");
    }

    let lon, lat, label = "";

    if (mode === "lonlat") {
      const lonN = toNumber(lonEl.value);
      const latN = toNumber(latEl.value);
      const err = validateLonLat(lonN, latN);
      if (err) throw new Error(err);
      lon = lonN;
      lat = latN;
      label = "";
    }

    if (mode === "address") {
      const cc = countryCodeEl.value;
      const g = await geocodeAddress(addressEl.value, cc);
      lon = g.lon;
      lat = g.lat;
      label = g.label;
    }

    if (mode === "lambert") {
      const x = toNumber(eastingEl.value);
      const y = toNumber(northingEl.value);
      if (x === null || y === null) throw new Error("Easting and northing must be numbers.");

      let crs = lambertCrsEl.value;
      if (crs === "auto") crs = detectLambertCrs(y);

      const w = lambertToWgs84(x, y, crs);
      const err = validateLonLat(w.lon, w.lat);
      if (err) throw new Error(`Lambert → WGS84 conversion produced invalid coordinates: ${err}`);

      lon = w.lon;
      lat = w.lat;
      label = `from ${crs}`;
    }

    // Display BOTH coordinate systems below the entry point (in black)
    // For Lambert display: prefer EPSG:31370 output unless user is specifically in Lambert mode with 3812 selected.
    const lambertDisplayCrs =
      mode === "lambert" && lambertCrsEl.value !== "auto" ? lambertCrsEl.value : "EPSG:31370";
    const lam = wgs84ToLambert(lon, lat, lambertDisplayCrs);

    updateResolvedCoordinateDisplay({
      lon,
      lat,
      lambertX: lam.x,
      lambertY: lam.y,
      lambertCrs: lam.crs,
      label,
    });

    // Compute factor
    setStatus("Fetching elevations & calculating…", "info");
    const { c0, Ac, Am, points, elevations } = await computeOrographyFactorComplex(lon, lat, zRef);

    orographyFactorEl.textContent = c0.toFixed(3);
    AcEl.textContent = Ac.toFixed(1);
    AmEl.textContent = Am.toFixed(1);

    renderSamples(points, elevations);

    // Warn if beyond typical validity range mentioned in some national annex guidance
    if (c0 > 1.15) {
      warningEl.textContent =
        "Note: c₀ > 1.15 — this simplified “complex orography” approach may no longer be appropriate; consider the Eurocode general procedure.";
      warningEl.classList.remove("hidden");
    } else {
      warningEl.classList.add("hidden");
    }

    setStatus("Done.", "ok");
  }

  // -----------------------------
  // Events
  // -----------------------------
  inputType.addEventListener("change", () => {
    showPanel(inputType.value);
    clearOutputs();
    setStatus("");
  });

  clearBtn.addEventListener("click", () => {
    clearInputs();
    clearOutputs();
    showPanel(inputType.value);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearOutputs();
    try {
      setLoading(true);
      await run();
    } catch (err) {
      setStatus(err && err.message ? err.message : "Something went wrong.", "error");
    } finally {
      setLoading(false);
    }
  });

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    showPanel(inputType.value);
    clearOutputs();

    if (typeof proj4 === "undefined") {
      setStatus("Proj4js did not load. Check your internet connection.", "error");
      return;
    }
    defineCrs();
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
