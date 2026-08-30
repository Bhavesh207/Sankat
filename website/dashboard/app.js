// ==========================================================
// SANKET Rescue Dashboard - app.js
// initMap must be global so Google Maps callback can find it
// ==========================================================

let map;
let markers = {};
let currentPolyline = null;

window.initMap = function() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 26.9124, lng: 75.7873 },
        zoom: 13,
        mapTypeId: 'roadmap',
        styles: [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
            { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
            { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
            { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
            { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
            { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
            { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
            { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
            { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
        ]
    });
};

// Focus map on a specific incident location
window.focusOnMap = function(lat, lng, id, event) {
    if (event) event.stopPropagation();
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (!map || isNaN(parsedLat) || isNaN(parsedLng)) return;
    map.panTo({ lat: parsedLat, lng: parsedLng });
    map.setZoom(16);
    if (markers[id]) {
        markers[id].infoWindow.open({ anchor: markers[id].marker, map });
    }
};

// Show location history when incident card is clicked
window.showLocationHistory = function(id) {
    fetch('/api/sos/' + id + '/location-history')
        .then(res => res.json())
        .then(history => {
            if (!map || !history || history.length === 0) return;
            if (currentPolyline) currentPolyline.setMap(null);
            const path = history.map(h => ({ lat: h.latitude, lng: h.longitude }));
            currentPolyline = new google.maps.Polyline({
                path,
                geodesic: true,
                strokeColor: '#5BB0E0',
                strokeOpacity: 0.8,
                strokeWeight: 3,
                map
            });
            if (path.length > 0) {
                map.panTo(path[path.length - 1]);
                map.setZoom(15);
            }
        })
        .catch(() => {});
};

window.acknowledgeIncident = async function(id, event) {
    if (event) event.stopPropagation();
    try {
        const res = await fetch('/api/sos/' + id + '/acknowledge', { method: 'POST' });
        if (res.ok) { fetchIncidents(); fetchStats(); }
    } catch (err) { console.error('Acknowledge error:', err); }
};

window.dispatchIncident = async function(id, event) {
    if (event) event.stopPropagation();
    try {
        const res = await fetch('/api/sos/' + id + '/dispatch', { method: 'POST' });
        if (res.ok) { fetchIncidents(); fetchStats(); }
    } catch (err) { console.error('Dispatch error:', err); }
};

// ==========================================================
// DOM-ready code
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
    const clockEl        = document.getElementById('live-clock');
    const incidentsListEl = document.getElementById('incidents-list');
    const statTotalEl    = document.getElementById('stat-total');
    const statCriticalEl = document.getElementById('stat-critical');
    const statPendingEl  = document.getElementById('stat-pending');
    const statAckEl      = document.getElementById('stat-ack');
    const statNodesEl    = document.getElementById('stat-nodes');
    const uptimeEl       = document.getElementById('uptime');

    let previousCriticalCount = 0;
    const startTime = Date.now();

    // Clock + uptime ticker
    setInterval(() => {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
        const uptimeSecs = Math.floor((Date.now() - startTime) / 1000);
        const hrs  = Math.floor(uptimeSecs / 3600);
        const mins = Math.floor((uptimeSecs % 3600) / 60);
        uptimeEl.textContent = hrs + 'h ' + mins + 'm';
    }, 1000);

    // ----------------------------------------------------------
    // Helper: pick colour for priority / status
    // ----------------------------------------------------------
    function getColorForPriority(priority, status) {
        if (status === 'ACKNOWLEDGED') return '#4ade80';
        switch ((priority || '').toUpperCase()) {
            case 'CRITICAL': return '#FF3B3B';
            case 'HIGH':     return '#F97316';
            case 'MEDIUM':   return '#FACC15';
            default:         return '#5BB0E0';
        }
    }

    // ----------------------------------------------------------
    // Build incident card HTML
    // ----------------------------------------------------------
    function createIncidentCard(inc) {
        const priority     = (inc.priority || 'LOW').toUpperCase();
        const isCritical   = priority === 'CRITICAL';
        const priorityClass = priority.toLowerCase();
        const priorityText  = priority;

        const statusClass = {
            'ACKNOWLEDGED': 'status-ack',
            'DISPATCHED':   'status-ack',
            'PENDING':      'status-pending',
            'CREATED':      'status-pending',
            'RELAYING':     'status-pending',
            'DELIVERED_TO_GATEWAY': 'status-ack',
        }[inc.status] || 'status-pending';

        let timeStr = 'Unknown';
        let isNew   = false;
        if (inc.timestamp) {
            const d = new Date(inc.timestamp);
            if (!isNaN(d)) {
                timeStr = d.toLocaleString();
                const diffMins = (Date.now() - d.getTime()) / 60000;
                if (diffMins < 2 && inc.status === 'PENDING') isNew = true;
            } else {
                timeStr = inc.timestamp;
            }
        }

        const lat = inc.latitude  || (inc.location && inc.location.lat)  || 'N/A';
        const lng = inc.longitude || (inc.location && inc.location.lng)   || 'N/A';
        const accuracy = inc.accuracy || (inc.location && inc.location.accuracy) || inc.location_accuracy;
        const accuracyStr = accuracy ? ('+-' + accuracy + 'm') : '';

        const newBadge = isNew
            ? '<span style="background:#4ade80;color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;font-weight:bold;margin-left:10px;">NEW</span>'
            : '';

        let routeDisplay = '';
        if (inc.route && Array.isArray(inc.route) && inc.route.length > 0) {
            const pathStrs = inc.route.slice();
            if (inc.gatewayId) pathStrs.push(inc.gatewayId + ' (GW)');
            routeDisplay = '<div class="info-group route-display">'
                + '<div class="info-label">Route Hop Path</div>'
                + '<div class="info-value route-path">' + pathStrs.join(' &rarr; ') + '</div>'
                + '</div>';
        }

        const hopInfo = (inc.hopCount != null)
            ? '<div class="info-group"><div class="info-label">Hops / TTL</div>'
              + '<div class="info-value monospace">' + inc.hopCount + ' hops / TTL ' + (inc.ttl != null ? inc.ttl : 'N/A') + '</div></div>'
            : '';

        const mapBtn = (lat !== 'N/A' && lng !== 'N/A')
            ? '<button class="btn btn-map" onclick="focusOnMap(\'' + lat + '\',\'' + lng + '\',\'' + (inc.message_id) + '\',event)">SHOW ON MAP</button>'
            : '';

        const ackBtn = (inc.status !== 'ACKNOWLEDGED' && inc.status !== 'DISPATCHED')
            ? '<button class="btn btn-ack" onclick="acknowledgeIncident(\'' + inc.message_id + '\',event)">ACKNOWLEDGE</button>'
            : '<button class="btn btn-ack" disabled>ACKNOWLEDGED</button>';

        return '<div class="incident-card ' + (isCritical ? 'critical' : '') + '" onclick="showLocationHistory(\'' + (inc.id || inc.message_id) + '\')" style="cursor:pointer;">'
            + '<div class="incident-header">'
            +   '<div style="display:flex;align-items:center;">'
            +     '<div class="incident-id">' + (inc.message_id || 'UNKNOWN') + '</div>'
            +     newBadge
            +   '</div>'
            +   '<div class="badge badge-' + priorityClass + '">' + priorityText + '</div>'
            + '</div>'
            + '<div class="incident-body">'
            +   '<div class="info-group"><div class="info-label">Victim / Device ID</div><div class="info-value monospace">' + (inc.source_device_id || 'Unknown') + '</div></div>'
            +   '<div class="info-group"><div class="info-label">Location</div><div class="info-value monospace">' + lat + ', ' + lng + ' <span style="font-size:0.8rem;color:var(--text-muted);">' + accuracyStr + '</span></div></div>'
            +   '<div class="info-group"><div class="info-label">Timestamp</div><div class="info-value">' + timeStr + '</div></div>'
            +   hopInfo
            +   routeDisplay
            +   '<div class="incident-message">"' + (inc.message || inc.emergency_message || 'Help requested.') + '"</div>'
            + '</div>'
            + '<div class="incident-footer">'
            +   '<div class="status-badge ' + statusClass + '"><div class="status-dot-small"></div>' + (inc.status || 'PENDING') + '</div>'
            +   '<div class="action-buttons">' + mapBtn + ackBtn
            +     '<button class="btn btn-dispatch" onclick="dispatchIncident(\'' + inc.message_id + '\',event)">DISPATCH</button>'
            +   '</div>'
            + '</div>'
            + '</div>';
    }

    // ----------------------------------------------------------
    // Fetch stats
    // ----------------------------------------------------------
    async function fetchStats() {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const stats = await res.json();
            statTotalEl.textContent    = stats.total    || 0;
            statCriticalEl.textContent = stats.critical || 0;
            statPendingEl.textContent  = stats.pending  || 0;
            statAckEl.textContent      = stats.acknowledged || 0;
            statNodesEl.textContent    = stats.activeNodes  || 0;
            if ((stats.critical || 0) > previousCriticalCount) {
                console.warn('New CRITICAL incident!');
            }
            previousCriticalCount = stats.critical || 0;
        } catch (err) {
            console.error('Stats error:', err);
        }
    }

    // ----------------------------------------------------------
    // Fetch incidents + update map markers
    // ----------------------------------------------------------
    async function fetchIncidents() {
        try {
            const res = await fetch('/api/incidents');
            if (!res.ok) return;
            const incidents = await res.json();

            if (incidents.length === 0) {
                incidentsListEl.innerHTML = '<div class="empty-state">No active incidents.</div>';
                return;
            }

            incidents.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            incidentsListEl.innerHTML = incidents.map(createIncidentCard).join('');

            if (!map) return;

            const currentIds = new Set();
            incidents.forEach(inc => {
                const id  = inc.message_id;
                const lat = parseFloat(inc.latitude  || (inc.location && inc.location.lat));
                const lng = parseFloat(inc.longitude || (inc.location && inc.location.lng));
                if (!id || isNaN(lat) || isNaN(lng)) return;
                currentIds.add(id);

                const color = getColorForPriority(inc.priority, inc.status);
                const iconOpts = {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 9,
                    fillColor: color,
                    fillOpacity: 0.9,
                    strokeColor: '#ffffff',
                    strokeWeight: 2
                };
                const infoContent = '<div style="color:#000;padding:4px;">'
                    + '<strong>' + (inc.source_device_id || 'Unknown') + '</strong><br>'
                    + 'Priority: ' + (inc.priority || 'LOW') + '<br>'
                    + (inc.message || 'Help requested.')
                    + '</div>';

                if (markers[id]) {
                    markers[id].marker.setPosition({ lat, lng });
                    markers[id].marker.setIcon(iconOpts);
                    markers[id].infoWindow.setContent(infoContent);
                } else {
                    const marker = new google.maps.Marker({ position: { lat, lng }, map, icon: iconOpts, title: inc.source_device_id });
                    const infoWindow = new google.maps.InfoWindow({ content: infoContent });
                    marker.addListener('click', () => infoWindow.open({ anchor: marker, map }));
                    markers[id] = { marker, infoWindow };
                }
            });

            // Remove markers for deleted incidents
            Object.keys(markers).forEach(id => {
                if (!currentIds.has(id)) {
                    markers[id].marker.setMap(null);
                    delete markers[id];
                }
            });

        } catch (err) {
            console.error('Incidents error:', err);
            if (!incidentsListEl.querySelector('.incident-card')) {
                incidentsListEl.innerHTML = '<div class="empty-state" style="color:var(--accent-red)">Error loading. Check backend connection.</div>';
            }
        }
    }

    // Initial load + polling every 3 seconds
    fetchStats();
    fetchIncidents();
    setInterval(fetchStats,     3000);
    setInterval(fetchIncidents, 3000);
});
