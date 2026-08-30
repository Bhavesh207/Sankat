// ============================================================
// SANKET Rescue Dashboard — app.js
// Global scope: initMap + action handlers (must be defined
// before Google Maps script fires its callback)
// ============================================================

let map;
let markers = {};
let currentPolyline = null;

// ── Google Maps init ──────────────────────────────────────
window.initMap = function () {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 26.9124, lng: 75.7873 },
        zoom: 13,
        mapTypeId: 'roadmap',
        styles: [
            { elementType: 'geometry',           stylers: [{ color: '#242f3e' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
            { elementType: 'labels.text.fill',   stylers: [{ color: '#746855' }] },
            { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
            { featureType: 'poi',         elementType: 'labels.text.fill',   stylers: [{ color: '#d59563' }] },
            { featureType: 'poi.park',    elementType: 'geometry',           stylers: [{ color: '#263c3f' }] },
            { featureType: 'poi.park',    elementType: 'labels.text.fill',   stylers: [{ color: '#6b9a76' }] },
            { featureType: 'road',        elementType: 'geometry',           stylers: [{ color: '#38414e' }] },
            { featureType: 'road',        elementType: 'geometry.stroke',    stylers: [{ color: '#212a37' }] },
            { featureType: 'road',        elementType: 'labels.text.fill',   stylers: [{ color: '#9ca5b3' }] },
            { featureType: 'road.highway',elementType: 'geometry',           stylers: [{ color: '#746855' }] },
            { featureType: 'road.highway',elementType: 'geometry.stroke',    stylers: [{ color: '#1f2835' }] },
            { featureType: 'road.highway',elementType: 'labels.text.fill',   stylers: [{ color: '#f3d19c' }] },
            { featureType: 'transit',     elementType: 'geometry',           stylers: [{ color: '#2f3948' }] },
            { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
            { featureType: 'water',       elementType: 'geometry',           stylers: [{ color: '#17263c' }] },
            { featureType: 'water',       elementType: 'labels.text.fill',   stylers: [{ color: '#515c6d' }] },
            { featureType: 'water',       elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] }
        ]
    });
};

// ── Focus map on a location ───────────────────────────────
window.focusOnMap = function (lat, lng, id, event) {
    if (event) event.stopPropagation();
    const la = parseFloat(lat), lo = parseFloat(lng);
    if (!map || isNaN(la) || isNaN(lo)) return;
    // Switch to dashboard panel first
    switchPanel('panel-dashboard');
    map.panTo({ lat: la, lng: lo });
    map.setZoom(16);
    if (markers[id]) markers[id].infoWindow.open({ anchor: markers[id].marker, map });
};

// ── Resolve dialog state ──────────────────────────────────
let _pendingResolveId = null;

window.openResolveDialog = function (id, event) {
    if (event) event.stopPropagation();
    _pendingResolveId = id;
    document.getElementById('resolve-overlay').classList.add('open');
    document.getElementById('resolve-dialog').classList.add('open');
};
window.closeResolveDialog = function () {
    _pendingResolveId = null;
    document.getElementById('resolve-overlay').classList.remove('open');
    document.getElementById('resolve-dialog').classList.remove('open');
};

// ── Open incident detail modal ────────────────────────────
window.openIncidentDetail = async function (id, event) {
    if (event) event.stopPropagation();
    document.getElementById('modal-title').textContent = 'Incident — ' + id;
    document.getElementById('modal-body').innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;">Loading...</div>';
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('incident-modal').classList.add('open');

    try {
        const [incRes, eventsRes] = await Promise.all([
            fetch('/api/sos/' + id),
            fetch('/api/sos/' + id + '/events')
        ]);
        const inc    = await incRes.json();
        const events = await eventsRes.json();
        document.getElementById('modal-body').innerHTML = buildModalBody(inc, events);
    } catch (e) {
        document.getElementById('modal-body').innerHTML = '<div style="color:var(--accent-red);padding:20px;">Error loading details.</div>';
    }
};

window.closeModal = function () {
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('incident-modal').classList.remove('open');
};

// ── Acknowledge ───────────────────────────────────────────
window.acknowledgeIncident = async function (id, event) {
    if (event) event.stopPropagation();
    try {
        const res = await fetch('/api/sos/' + id + '/acknowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operatorId: 'admin' })
        });
        if (res.ok) { fetchActiveIncidents(); fetchStats(); }
    } catch (e) { console.error('Acknowledge error:', e); }
};

// ── Dispatch ──────────────────────────────────────────────
window.dispatchIncident = async function (id, event) {
    if (event) event.stopPropagation();
    try {
        const res = await fetch('/api/sos/' + id + '/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operatorId: 'admin' })
        });
        if (res.ok) { fetchActiveIncidents(); fetchStats(); }
    } catch (e) { console.error('Dispatch error:', e); }
};

// ── Reopen ────────────────────────────────────────────────
window.reopenIncident = async function (id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Reopen incident ' + id + ' and move it back to Active?')) return;
    try {
        const res = await fetch('/api/sos/' + id + '/reopen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operatorId: 'admin' })
        });
        if (res.ok) { fetchHistory(); fetchStats(); switchPanel('panel-dashboard'); }
    } catch (e) { console.error('Reopen error:', e); }
};

// ── Location history (polyline on map) ───────────────────
window.showLocationHistory = async function (id) {
    try {
        const res = await fetch('/api/sos/' + id + '/location-history');
        if (!res.ok) return;
        const history = await res.json();
        if (!map || !history || history.length === 0) return;
        if (currentPolyline) currentPolyline.setMap(null);
        const path = history
            .filter(h => h.latitude && h.longitude)
            .map(h => ({ lat: parseFloat(h.latitude), lng: parseFloat(h.longitude) }));
        if (path.length === 0) return;
        currentPolyline = new google.maps.Polyline({
            path, geodesic: true,
            strokeColor: '#5BB0E0', strokeOpacity: 0.85, strokeWeight: 3, map
        });
        map.panTo(path[path.length - 1]);
        map.setZoom(15);
    } catch (e) { /* silent */ }
};

// ============================================================
// DOM-READY
// ============================================================
document.addEventListener('DOMContentLoaded', function () {

    // ── Element refs ──────────────────────────────────────
    const clockEl        = document.getElementById('live-clock');
    const uptimeEl       = document.getElementById('uptime');
    const statActiveEl   = document.getElementById('stat-active');
    const statCritEl     = document.getElementById('stat-critical');
    const statResTodEl   = document.getElementById('stat-resolved-today');
    const statResWkEl    = document.getElementById('stat-resolved-week');
    const statNodesEl    = document.getElementById('stat-nodes');
    const activeBadgeEl  = document.getElementById('active-count-badge');
    const incListEl      = document.getElementById('incidents-list');
    const histListEl     = document.getElementById('history-list');
    const auditTbody     = document.getElementById('audit-tbody');

    const startTime = Date.now();

    // ── Clock ─────────────────────────────────────────────
    setInterval(function () {
        clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
        const s = Math.floor((Date.now() - startTime) / 1000);
        uptimeEl.textContent = Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    }, 1000);

    // ── Nav panel switching ───────────────────────────────
    document.querySelectorAll('.nav-links li').forEach(function (li) {
        li.addEventListener('click', function () {
            const panelId = li.getAttribute('data-panel');
            switchPanel(panelId);
        });
    });

    // ── Resolve confirm button ────────────────────────────
    document.getElementById('resolve-confirm-btn').addEventListener('click', async function () {
        if (!_pendingResolveId) return;
        const operatorId = document.getElementById('resolve-operator').value.trim() || 'admin';
        try {
            const res = await fetch('/api/sos/' + _pendingResolveId + '/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operatorId })
            });
            if (res.ok) {
                closeResolveDialog();
                fetchActiveIncidents();
                fetchStats();
            }
        } catch (e) { console.error('Resolve error:', e); }
    });

    // ── History filters ───────────────────────────────────
    document.getElementById('hist-apply').addEventListener('click', fetchHistory);
    document.getElementById('hist-clear').addEventListener('click', function () {
        document.getElementById('hist-search').value    = '';
        document.getElementById('hist-priority').value  = '';
        document.getElementById('hist-status').value    = '';
        document.getElementById('hist-date').value      = 'all';
        fetchHistory();
    });

    // ── Audit filters ─────────────────────────────────────
    document.getElementById('audit-apply').addEventListener('click', fetchAuditLog);
    document.getElementById('audit-clear').addEventListener('click', function () {
        document.getElementById('audit-event-type').value  = '';
        document.getElementById('audit-incident-id').value = '';
        document.getElementById('audit-date-from').value   = '';
        document.getElementById('audit-date-to').value     = '';
        fetchAuditLog();
    });

    // ── Initial data load ─────────────────────────────────
    fetchStats();
    fetchActiveIncidents();
    setInterval(fetchStats,           5000);
    setInterval(fetchActiveIncidents, 5000);

    // ============================================================
    // STATS
    // ============================================================
    async function fetchStats() {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const s = await res.json();
            statActiveEl.textContent  = s.active          || 0;
            statCritEl.textContent    = s.critical         || 0;
            statResTodEl.textContent  = s.resolvedToday    || 0;
            statResWkEl.textContent   = s.resolvedThisWeek || 0;
            statNodesEl.textContent   = s.activeNodes      || 0;
        } catch (e) { console.error('Stats error:', e); }
    }

    // ============================================================
    // ACTIVE INCIDENTS
    // ============================================================
    async function fetchActiveIncidents() {
        try {
            const res = await fetch('/api/incidents/active');
            if (!res.ok) return;
            const incidents = await res.json();

            if (incidents.length === 0) {
                incListEl.innerHTML = '<div class="empty-state">No active incidents. System is clear.</div>';
                activeBadgeEl.textContent = '0 requiring attention';
                clearMapMarkersExcept([]);
                return;
            }

            incidents.sort(function (a, b) {
                const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
                const pa = order[(a.priority || 'LOW').toUpperCase()] || 3;
                const pb = order[(b.priority || 'LOW').toUpperCase()] || 3;
                if (pa !== pb) return pa - pb;
                return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
            });

            incListEl.innerHTML = incidents.map(buildActiveCard).join('');
            activeBadgeEl.textContent = incidents.length + ' requiring attention';

            if (!map) return;
            const currentIds = new Set();
            incidents.forEach(function (inc) {
                const id  = inc.message_id;
                const lat = parseFloat(inc.latitude  || (inc.location && inc.location.lat));
                const lng = parseFloat(inc.longitude || (inc.location && inc.location.lng));
                if (!id || isNaN(lat) || isNaN(lng)) return;
                currentIds.add(id);
                updateOrCreateMarker(inc, id, lat, lng);
            });
            clearMapMarkersExcept(currentIds);

        } catch (e) {
            console.error('Active incidents error:', e);
        }
    }

    // ============================================================
    // HISTORY
    // ============================================================
    async function fetchHistory() {
        histListEl.innerHTML = '<div class="empty-state">Loading...</div>';
        try {
            const search   = document.getElementById('hist-search').value.trim();
            const priority = document.getElementById('hist-priority').value;
            const status   = document.getElementById('hist-status').value;
            const datePreset = document.getElementById('hist-date').value;

            let params = new URLSearchParams();
            if (search)   params.set('search', search);
            if (priority) params.set('priority', priority);
            if (status)   params.set('status', status);

            // Convert date preset to dateFrom
            const now = new Date();
            if (datePreset === 'today') {
                params.set('dateFrom', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
            } else if (datePreset === 'yesterday') {
                const y = new Date(now); y.setDate(y.getDate() - 1);
                params.set('dateFrom', new Date(y.getFullYear(), y.getMonth(), y.getDate()).toISOString());
                params.set('dateTo',   new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
            } else if (datePreset === '7days') {
                const d = new Date(now); d.setDate(d.getDate() - 7);
                params.set('dateFrom', d.toISOString());
            } else if (datePreset === '30days') {
                const d = new Date(now); d.setDate(d.getDate() - 30);
                params.set('dateFrom', d.toISOString());
            }

            const res = await fetch('/api/incidents/history?' + params.toString());
            if (!res.ok) { histListEl.innerHTML = '<div class="empty-state" style="color:var(--accent-red)">Error loading history.</div>'; return; }
            const incidents = await res.json();

            if (incidents.length === 0) {
                histListEl.innerHTML = '<div class="empty-state">No historical incidents found for the selected filters.</div>';
                return;
            }

            histListEl.innerHTML = incidents.map(buildHistoryCard).join('');
        } catch (e) {
            console.error('History error:', e);
            histListEl.innerHTML = '<div class="empty-state" style="color:var(--accent-red)">Error loading history.</div>';
        }
    }

    // ============================================================
    // AUDIT LOG
    // ============================================================
    async function fetchAuditLog() {
        auditTbody.innerHTML = '<tr><td colspan="6" class="audit-empty">Loading...</td></tr>';
        try {
            const params = new URLSearchParams();
            const eventType  = document.getElementById('audit-event-type').value;
            const incidentId = document.getElementById('audit-incident-id').value.trim();
            const dateFrom   = document.getElementById('audit-date-from').value;
            const dateTo     = document.getElementById('audit-date-to').value;

            if (eventType)  params.set('eventType', eventType);
            if (incidentId) params.set('incidentId', incidentId);
            if (dateFrom)   params.set('dateFrom', dateFrom);
            if (dateTo)     params.set('dateTo', dateTo);

            const res = await fetch('/api/audit?' + params.toString());
            if (!res.ok) { auditTbody.innerHTML = '<tr><td colspan="6" class="audit-empty" style="color:var(--accent-red)">Error loading audit log.</td></tr>'; return; }
            const logs = await res.json();

            if (logs.length === 0) {
                auditTbody.innerHTML = '<tr><td colspan="6" class="audit-empty">No audit events found.</td></tr>';
                return;
            }

            auditTbody.innerHTML = logs.map(buildAuditRow).join('');
        } catch (e) {
            console.error('Audit log error:', e);
            auditTbody.innerHTML = '<tr><td colspan="6" class="audit-empty" style="color:var(--accent-red)">Error loading audit log.</td></tr>';
        }
    }

    // ============================================================
    // MAP HELPERS
    // ============================================================
    function updateOrCreateMarker(inc, id, lat, lng) {
        const color = colorForPriority(inc.priority, inc.status);
        const iconOpts = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9, fillColor: color, fillOpacity: 0.9,
            strokeColor: '#fff', strokeWeight: 2
        };
        const infoContent = '<div style="color:#000;padding:4px;font-family:sans-serif;">'
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
            marker.addListener('click', function () { infoWindow.open({ anchor: marker, map }); });
            markers[id] = { marker, infoWindow };
        }
    }

    function clearMapMarkersExcept(idSet) {
        Object.keys(markers).forEach(function (id) {
            if (!idSet.has(id)) {
                markers[id].marker.setMap(null);
                delete markers[id];
            }
        });
    }

    function colorForPriority(priority, status) {
        if (status === 'ACKNOWLEDGED') return '#facc15';
        if (status === 'DISPATCHED')   return '#f97316';
        switch ((priority || 'LOW').toUpperCase()) {
            case 'CRITICAL': return '#FF3B3B';
            case 'HIGH':     return '#f97316';
            case 'MEDIUM':   return '#facc15';
            default:         return '#5BB0E0';
        }
    }

    // ============================================================
    // CARD BUILDERS
    // ============================================================
    function buildActiveCard(inc) {
        const priority    = (inc.priority || 'LOW').toUpperCase();
        const priorityLow = priority.toLowerCase();
        const statusLow   = (inc.status || 'pending').toLowerCase();

        const lat = inc.latitude  || (inc.location && inc.location.lat)  || null;
        const lng = inc.longitude || (inc.location && inc.location.lng)  || null;
        const locStr = (lat && lng && lat !== 0 && lng !== 0)
            ? lat.toFixed(4) + ', ' + lng.toFixed(4)
            : 'Location unavailable';
        const accuracy = inc.accuracy || (inc.location && inc.location.accuracy) || inc.location_accuracy;
        const accStr = accuracy ? ' (+-' + accuracy + 'm)' : '';

        let timeStr = 'Unknown';
        if (inc.timestamp) {
            const d = new Date(inc.timestamp);
            if (!isNaN(d)) timeStr = d.toLocaleTimeString('en-US', { hour12: false });
        }

        let isNew = false;
        if (inc.created_at) {
            const d = new Date(inc.created_at);
            if (!isNaN(d) && (Date.now() - d.getTime()) < 120000 && inc.status === 'PENDING') isNew = true;
        }

        const newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';

        let routeHtml = '';
        if (inc.route && inc.route.length > 1) {
            routeHtml = '<div class="info-group route-display"><div class="info-label">Relay Route</div>'
                + '<div class="info-value route-path">' + inc.route.join(' > ') + '</div></div>';
        }

        const mapBtnHtml = (lat && lng && lat !== 0 && lng !== 0)
            ? '<button class="btn btn-map" onclick="focusOnMap(\'' + lat + '\',\'' + lng + '\',\'' + inc.message_id + '\',event)">SHOW ON MAP</button>'
            : '';

        const ackDisabled = (inc.status !== 'PENDING' && inc.status !== 'CREATED');
        const dispDisabled = (inc.status === 'DISPATCHED' || inc.status === 'RESOLVED');

        return '<div class="incident-card priority-' + priorityLow + '" onclick="showLocationHistory(\'' + (inc.id || inc.message_id) + '\')">'
            + '<div class="incident-header">'
            +   '<div style="display:flex;align-items:center;">'
            +     '<div class="incident-id">' + (inc.message_id || 'UNKNOWN') + '</div>' + newBadge
            +   '</div>'
            +   '<div class="badge badge-' + priorityLow + '">' + priority + '</div>'
            + '</div>'
            + '<div class="incident-body">'
            +   '<div class="info-group"><div class="info-label">Victim Device</div><div class="info-value monospace">' + (inc.source_device_id || 'Unknown') + '</div></div>'
            +   '<div class="info-group"><div class="info-label">Location</div><div class="info-value monospace">' + locStr + '<span style="color:var(--text-muted);font-size:0.78rem;">' + accStr + '</span></div></div>'
            +   '<div class="info-group"><div class="info-label">Received</div><div class="info-value">' + timeStr + '</div></div>'
            +   (inc.hopCount ? '<div class="info-group"><div class="info-label">Hops / TTL</div><div class="info-value monospace">' + inc.hopCount + ' / ' + (inc.ttl != null ? inc.ttl : 'N/A') + '</div></div>' : '')
            +   routeHtml
            +   '<div class="incident-message">"' + (inc.message || 'Help requested.') + '"</div>'
            + '</div>'
            + '<div class="incident-footer">'
            +   '<div class="status-badge status-' + statusLow + '"><div class="status-dot-small"></div>' + (inc.status || 'PENDING') + '</div>'
            +   '<div class="action-buttons">'
            +     mapBtnHtml
            +     '<button class="btn btn-ack" onclick="acknowledgeIncident(\'' + inc.message_id + '\',event)"' + (ackDisabled ? ' disabled' : '') + '>' + (ackDisabled ? 'ACKNOWLEDGED' : 'ACKNOWLEDGE') + '</button>'
            +     '<button class="btn btn-dispatch" onclick="dispatchIncident(\'' + inc.message_id + '\',event)"' + (dispDisabled ? ' disabled' : '') + '>DISPATCH</button>'
            +     '<button class="btn btn-resolve" onclick="openResolveDialog(\'' + inc.message_id + '\',event)">RESOLVE</button>'
            +     '<button class="btn btn-detail" onclick="openIncidentDetail(\'' + inc.message_id + '\',event)">DETAILS</button>'
            +   '</div>'
            + '</div>'
            + '</div>';
    }

    function buildHistoryCard(inc) {
        const priority = (inc.priority || 'LOW').toUpperCase();
        const status   = inc.status || 'RESOLVED';

        let createdStr  = 'N/A', resolvedStr = 'N/A', duration = 'N/A';
        if (inc.created_at) createdStr  = fmtDateTime(inc.created_at);
        if (inc.resolvedAt)  resolvedStr = fmtDateTime(inc.resolvedAt);
        if (inc.resolutionTime != null) duration = fmtDuration(inc.resolutionTime);

        const statusClass = status.toLowerCase();
        return '<div class="history-card ' + statusClass + '">'
            + '<div><div class="hc-id">' + (inc.message_id || inc.id || 'UNKNOWN') + '</div>'
            +      '<div class="badge badge-' + priority.toLowerCase() + '" style="margin-top:6px;">' + priority + '</div></div>'
            + '<div class="hc-meta"><div class="hc-label">Victim</div><div class="hc-value">' + (inc.source_device_id || 'Unknown') + '</div>'
            +      '<div class="hc-label" style="margin-top:6px;">Message</div><div class="hc-value" style="color:var(--text-muted);">' + (inc.message || '').substring(0, 50) + '</div></div>'
            + '<div class="hc-meta"><div class="hc-label">Created</div><div class="hc-value">' + createdStr + '</div>'
            +      '<div class="hc-label" style="margin-top:6px;">Resolved</div><div class="hc-value">' + resolvedStr + '</div></div>'
            + '<div class="hc-meta"><div class="hc-label">Duration</div><div class="hc-duration">' + duration + '</div>'
            +      '<div class="hc-label" style="margin-top:6px;">Status</div><div class="status-badge status-' + statusClass + '" style="margin-top:2px;"><div class="status-dot-small"></div>' + status + '</div></div>'
            + '<div class="hc-actions">'
            +   '<button class="btn btn-detail" onclick="openIncidentDetail(\'' + (inc.message_id || inc.id) + '\',event)">DETAILS</button>'
            +   '<button class="btn btn-reopen" onclick="reopenIncident(\'' + (inc.message_id || inc.id) + '\',event)">REOPEN</button>'
            + '</div>'
            + '</div>';
    }

    function buildAuditRow(log) {
        const evtClass = eventClass(log.eventType || '');
        const timeStr  = log.timestamp ? fmtDateTime(log.timestamp) : 'N/A';
        const details  = log.previousStatus && log.newStatus
            ? 'Status: ' + log.previousStatus + ' -> ' + log.newStatus + (log.details ? ' | ' + log.details : '')
            : (log.details || '');
        return '<tr>'
            + '<td>' + timeStr + '</td>'
            + '<td><span class="audit-event-badge ' + evtClass + '">' + (log.eventType || 'UNKNOWN') + '</span></td>'
            + '<td>' + (log.incidentId || '-') + '</td>'
            + '<td>' + (log.deviceId   || '-') + '</td>'
            + '<td>' + (log.operatorId || '-') + '</td>'
            + '<td style="color:var(--text-muted);max-width:260px;white-space:pre-wrap;">' + details + '</td>'
            + '</tr>';
    }

    // ============================================================
    // MODAL BODY BUILDER
    // ============================================================
    function buildModalBody(inc, events) {
        const priority    = (inc.priority || 'LOW').toUpperCase();
        const priorityLow = priority.toLowerCase();
        const status      = inc.status || 'PENDING';
        const statusLow   = status.toLowerCase();

        // Parse all timestamps safely
        const createdStr  = fmtDateTime(inc.created_at);
        const ackStr      = fmtDateTime(inc.acknowledgedAt);
        const dispStr     = fmtDateTime(inc.dispatchedAt);
        const resolvedStr = fmtDateTime(inc.resolvedAt);

        const lat = inc.latitude  || (inc.location && inc.location.lat)  || null;
        const lng = inc.longitude || (inc.location && inc.location.lng)  || null;
        const locStr = (lat && lng && lat !== 0 && lng !== 0)
            ? parseFloat(lat).toFixed(6) + ', ' + parseFloat(lng).toFixed(6)
            : 'Location unavailable';
        const accuracy = inc.location_accuracy ? '+-' + inc.location_accuracy + 'm' : '';
        const mapsLink = (lat && lng && lat !== 0 && lng !== 0)
            ? '<a href="https://maps.google.com/?q=' + lat + ',' + lng + '" target="_blank" style="color:var(--accent-blue);text-decoration:none;font-size:0.75rem;margin-left:10px;">Open in Google Maps</a>'
            : '';

        const routeStr = (inc.route && inc.route.length > 0) ? inc.route.join(' > ') : 'Direct (no relay)';
        const resTime  = fmtDuration(inc.resolutionTime);
        const respTime = fmtDuration(inc.responseTime);
        const battery  = inc.battery != null ? inc.battery + '%' : 'N/A';

        // Status flow bar
        const allSteps = ['PENDING', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED'];
        const currentIdx = allSteps.indexOf(status);
        const statusFlowHtml = '<div class="status-flow">'
            + allSteps.map(function(step, i) {
                let cls = 'sf-step';
                if (i < currentIdx) cls += ' sf-done';
                if (i === currentIdx) cls += ' sf-current';
                return '<div class="' + cls + '">'
                    + '<div class="sf-circle">' + (i < currentIdx ? '&#10003;' : (i + 1)) + '</div>'
                    + '<div class="sf-label">' + step + '</div>'
                    + '</div>'
                    + (i < allSteps.length - 1 ? '<div class="sf-line' + (i < currentIdx ? ' sf-line-done' : '') + '"></div>' : '');
            }).join('')
            + '</div>';

        // Timeline
        const timelineHtml = events.length > 0
            ? events.map(function (ev) {
                const evTime   = fmtDateTime(ev.timestamp);
                const dotClass = dotClassForEvent(ev.eventType);
                const meta = ev.previousStatus && ev.newStatus
                    ? '<div class="timeline-meta">' + ev.previousStatus + ' &rarr; ' + ev.newStatus + '</div>'
                    : '';
                return '<div class="timeline-item">'
                    + '<div class="timeline-left"><div class="timeline-dot ' + dotClass + '"></div><div class="timeline-line"></div></div>'
                    + '<div class="timeline-content">'
                    +   '<div class="timeline-event">' + (ev.eventType || 'EVENT') + '</div>'
                    +   '<div class="timeline-time">' + evTime + '</div>'
                    +   (ev.operatorId && ev.operatorId !== 'SYSTEM' ? '<div class="timeline-operator">by ' + ev.operatorId + '</div>' : '<div class="timeline-operator" style="color:var(--text-muted)">System</div>')
                    +   meta
                    + '</div>'
                    + '</div>';
            }).join('')
            : '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px 0;">No timeline events recorded yet.</div>';

        return ''
            // ── STATUS FLOW ──
            + '<div class="modal-section">' + statusFlowHtml + '</div>'

            // ── IDENTITY ──
            + '<div class="modal-section">'
            + '<div class="modal-section-title">Incident Identity</div>'
            + '<div class="modal-grid3">'
            +   field('Incident ID',   '<span style="color:var(--accent-blue);font-size:0.95rem;font-weight:700;">' + (inc.message_id || inc.id || 'N/A') + '</span>')
            +   field('Victim Device', '<span style="color:var(--accent-blue);">' + (inc.source_device_id || 'Unknown') + '</span>')
            +   field('Battery',       battery)
            +   field('Priority',      '<span class="badge badge-' + priorityLow + '">' + priority + '</span>')
            +   field('Status',        '<span class="status-badge status-' + statusLow + '" style="font-size:0.8rem;"><div class="status-dot-small"></div>' + status + '</span>')
            +   field('Type',          inc.type || 'SOS')
            + '</div></div>'

            // ── MESSAGE ──
            + '<div class="modal-section">'
            + '<div class="modal-section-title">Emergency Message</div>'
            + '<div style="background:rgba(0,0,0,0.3);padding:14px 18px;border-radius:6px;border-left:3px solid var(--accent-red);font-style:italic;font-family:Courier New,monospace;color:var(--text-primary);font-size:0.95rem;line-height:1.6;">'
            + '"' + (inc.message || 'Help requested.') + '"'
            + '</div></div>'

            // ── LOCATION ──
            + '<div class="modal-section">'
            + '<div class="modal-section-title">Location' + mapsLink + '</div>'
            + '<div class="modal-grid3">'
            +   field('Coordinates',  locStr + (accuracy ? ' <span style="color:var(--text-muted);font-size:0.78rem;">' + accuracy + '</span>' : ''))
            +   field('Latitude',     lat ? parseFloat(lat).toFixed(6) : 'N/A')
            +   field('Longitude',    lng ? parseFloat(lng).toFixed(6) : 'N/A')
            + '</div></div>'

            // ── RELAY INFO ──
            + '<div class="modal-section">'
            + '<div class="modal-section-title">BLE Relay Info</div>'
            + '<div class="modal-grid3">'
            +   field('Route',        routeStr)
            +   field('Hop Count',    inc.hopCount != null ? inc.hopCount + ' hops' : 'Direct')
            +   field('TTL',          inc.ttl      != null ? inc.ttl : 'N/A')
            + '</div></div>'

            // ── TIMESTAMPS ──
            + '<div class="modal-section">'
            + '<div class="modal-section-title">Timestamps</div>'
            + '<div class="ts-grid">'
            +   tsField('Created',        createdStr,  '#5BB0E0')
            +   tsField('Acknowledged',   ackStr,      '#facc15')
            +   tsField('Dispatched',     dispStr,     '#f97316')
            +   tsField('Resolved',       resolvedStr, '#4ade80')
            + '</div>'
            + '<div class="modal-grid3" style="margin-top:14px;">'
            +   field('Response Time',   '<span style="color:var(--accent-yellow);font-weight:700;">' + respTime + '</span>')
            +   field('Resolution Time', '<span style="color:var(--accent-green);font-weight:700;">' + resTime + '</span>')
            +   field('Operator',        inc.operatorId || 'N/A')
            + '</div></div>'

            // ── TIMELINE ──
            + '<div class="modal-section">'
            + '<div class="modal-section-title">Event Timeline</div>'
            + '<div class="timeline">' + timelineHtml + '</div>'
            + '</div>';
    }

    function field(label, value) {
        return '<div class="modal-field">'
            + '<div class="modal-field-label">' + label + '</div>'
            + '<div class="modal-field-value">' + value + '</div>'
            + '</div>';
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function fmtDateTime(val) {
        if (!val) return 'N/A';
        if (val && typeof val === 'object' && val._seconds) {
            val = new Date(val._seconds * 1000);
        }
        const d = new Date(val);
        if (isNaN(d)) return String(val);
        return d.toLocaleDateString('en-IN') + ' ' + d.toLocaleTimeString('en-US', { hour12: false });
    }

    function fmtDuration(secs) {
        if (secs == null) return 'N/A';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    function eventClass(eventType) {
        if (eventType.includes('RECEIVED'))     return 'evt-received';
        if (eventType.includes('ACKNOWLEDGED')) return 'evt-ack';
        if (eventType.includes('DISPATCHED'))   return 'evt-dispatched';
        if (eventType.includes('RESOLVED'))     return 'evt-resolved';
        if (eventType.includes('REOPENED'))     return 'evt-reopened';
        return 'evt-system';
    }

    function dotClassForEvent(eventType) {
        if (!eventType) return '';
        if (eventType.includes('RESOLVED'))     return 'resolved';
        if (eventType.includes('ACKNOWLEDGED')) return 'ack';
        if (eventType.includes('DISPATCHED'))   return 'dispatch';
        return '';
    }

    // ── Fetch history & audit when switching panels ───────
    document.querySelectorAll('.nav-links li').forEach(function (li) {
        li.addEventListener('click', function () {
            const panelId = li.getAttribute('data-panel');
            if (panelId === 'panel-history') fetchHistory();
            if (panelId === 'panel-audit')   fetchAuditLog();
        });
    });
});

// ============================================================
// PANEL SWITCHER (global so focusOnMap can call it)
// ============================================================
function switchPanel(panelId) {
    document.querySelectorAll('.panel').forEach(function (p) {
        p.classList.remove('panel-active');
    });
    document.querySelectorAll('.nav-links li').forEach(function (li) {
        li.classList.remove('active');
    });
    const target = document.getElementById(panelId);
    if (target) target.classList.add('panel-active');
    const navItem = document.querySelector('[data-panel="' + panelId + '"]');
    if (navItem) navItem.classList.add('active');
    // Update header title
    const titles = {
        'panel-dashboard': 'Operations Center',
        'panel-history':   'Incident History',
        'panel-audit':     'Audit Log'
    };
    const headerTitleEl = document.getElementById('header-title');
    if (headerTitleEl) headerTitleEl.textContent = titles[panelId] || 'SANKET';
}
