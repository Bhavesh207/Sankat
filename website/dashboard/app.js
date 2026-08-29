document.addEventListener('DOMContentLoaded', () => {
    const clockEl = document.getElementById('live-clock');
    const incidentsListEl = document.getElementById('incidents-list');
    
    const statTotalEl = document.getElementById('stat-total');
    const statCriticalEl = document.getElementById('stat-critical');
    const statPendingEl = document.getElementById('stat-pending');
    const statAckEl = document.getElementById('stat-ack');
    const statNodesEl = document.getElementById('stat-nodes');
    const uptimeEl = document.getElementById('uptime');

    let previousCriticalCount = 0;
    const startTime = Date.now();

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

    setInterval(() => {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
        
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const hrs = Math.floor(uptimeSeconds / 3600);
        const mins = Math.floor((uptimeSeconds % 3600) / 60);
        uptimeEl.textContent = `${hrs}h ${mins}m`;
    }, 1000);

    async function fetchStats() {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const stats = await res.json();
            
            statTotalEl.textContent = stats.total;
            statCriticalEl.textContent = stats.critical;
            statPendingEl.textContent = stats.pending;
            statAckEl.textContent = stats.acknowledged;
            statNodesEl.textContent = stats.activeNodes;

            if (stats.critical > previousCriticalCount) {
                console.log("New CRITICAL incident detected!");
            }
            previousCriticalCount = stats.critical;
            
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    }

    window.acknowledgeIncident = async function(id, event) {
        if(event) event.stopPropagation();
        try {
            const res = await fetch('/api/sos/' + id + '/acknowledge', { method: 'POST' });
            if (res.ok) { fetchIncidents(); fetchStats(); }
        } catch (error) { console.error('Error acknowledging:', error); }
    };

    window.dispatchIncident = async function(id, event) {
        if(event) event.stopPropagation();
        try {
            const res = await fetch('/api/sos/' + id + '/dispatch', { method: 'POST' });
            if (res.ok) { fetchIncidents(); fetchStats(); }
        } catch (error) { console.error('Error dispatching:', error); }
    };

    window.focusOnMap = function(lat, lng, id, event) {
        if(event) event.stopPropagation();
        if(map && !isNaN(lat) && !isNaN(lng)) {
            map.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
            map.setZoom(17);
            if(markers[id]) {
                new google.maps.event.trigger(markers[id].marker, 'click');
            }
        }
    };

    function getColorForPriority(priority, status) {
        if (status === 'ACKNOWLEDGED') return '#4ade80';
        switch(priority?.toUpperCase()) {
            case 'CRITICAL': return '#ff3b3b';
            case 'HIGH': return '#f97316';
            case 'MEDIUM': return '#facc15';
            case 'LOW': return '#5bb0e0';
            default: return '#5bb0e0';
        }
    }

    window.showLocationHistory = async function(id) {
        try {
            const res = await fetch('/api/sos/' + id + '/locations');
            if (!res.ok) return;
            const history = await res.json();
            
            if (currentPolyline) {
                currentPolyline.setMap(null);
            }

            if (history && history.length > 0 && map) {
                const path = history.map(loc => ({ lat: loc.latitude, lng: loc.longitude }));
                currentPolyline = new google.maps.Polyline({
                    path: path, geodesic: true, strokeColor: '#ff3b3b', strokeOpacity: 0.7, strokeWeight: 4
                });
                currentPolyline.setMap(map);

                const bounds = new google.maps.LatLngBounds();
                path.forEach(coord => bounds.extend(coord));
                map.fitBounds(bounds);
            }
        } catch (error) {
            console.error('Error fetching location history:', error);
        }
    };

    function createIncidentCard(inc) {
        const priorityClass = inc.priority ? inc.priority.toLowerCase() : 'low';
        const priorityText = inc.priority || 'LOW';
        const isCritical = priorityClass === 'critical';
        const statusClass = inc.status === 'ACKNOWLEDGED' ? 'status-acknowledged' : 'status-pending';
        
        let timeStr = 'Unknown Time';
        let isNew = false;
        if (inc.timestamp) {
            const d = new Date(inc.timestamp);
            if (!isNaN(d.getTime())) {
                timeStr = d.toLocaleString();
                const diffMins = (new Date() - d) / 1000 / 60;
                // Consider it "NEW" if it's less than 2 minutes old and not acknowledged
                if (diffMins < 2 && inc.status === 'PENDING') {
                    isNew = true;
                }
            } else {
                timeStr = inc.timestamp;
            }
        }

        const lat = inc.latitude || inc.location?.lat || 'N/A';
        const lng = inc.longitude || inc.location?.lng || 'N/A';
        const accuracy = inc.accuracy || inc.location?.accuracy || inc.location_accuracy;
        const accuracyStr = accuracy ? `±${accuracy}m` : '';

        const newBadgeHtml = isNew ? `<span style="background: #4ade80; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; margin-left: 10px; animation: pulse 1.5s infinite;">NEW MESSAGE</span>` : '';

        let routeDisplay = '';
        if (inc.route && Array.isArray(inc.route) && inc.route.length > 0) {
            let pathStrs = inc.route.slice();
            if (inc.gatewayId) {
                pathStrs.push(inc.gatewayId + ' (GW)');
            }
            routeDisplay = `
                <div class="info-group route-display">
                    <div class="info-label">Route Hop Path</div>
                    <div class="info-value route-path">${pathStrs.join(' &rarr; ')}</div>
                </div>
            `;
        }

        return `
            <div class="incident-card ${isCritical ? 'critical' : ''}" onclick="showLocationHistory('${inc.id || inc.message_id}')" style="cursor: pointer;">
                <div class="incident-header">
                    <div style="display:flex; align-items:center;">
                        <div class="incident-id">${inc.message_id || 'UNKNOWN-ID'}</div>
                        ${newBadgeHtml}
                    </div>
                    <div class="badge badge-${priorityClass}">${priorityText}</div>
                </div>
                <div class="incident-body">
                    <div class="info-group">
                        <div class="info-label">Victim / Device ID</div>
                        <div class="info-value monospace">${inc.source_device_id || 'Unknown'}</div>
                    </div>
                    <div class="info-group">
                        <div class="info-label">Location (Coordinates)</div>
                        <div class="info-value monospace">${lat}, ${lng} <span style="font-size: 0.8rem; color: var(--text-muted);">${accuracyStr}</span></div>
                    </div>
                    <div class="info-group">
                        <div class="info-label">Timestamp</div>
                        <div class="info-value">${timeStr}</div>
                    </div>
                    ${inc.route_info ? `<div class="info-group"><div class="info-label">Route Info</div><div class="info-value">${inc.route_info}</div></div>` : ''}
                    ${routeDisplay}
                    <div class="incident-message">"${inc.message || inc.emergency_message || 'Help requested.'}"</div>
                </div>
                <div class="incident-footer">
                    <div class="status-badge ${statusClass}">
                        <div class="status-dot-small"></div>
                        ${inc.status || 'PENDING'}
                    </div>
                    <div class="action-buttons">
                        <button class="btn btn-map" onclick="focusOnMap('${lat}', '${lng}', '${inc.message_id}', event)">SHOW ON MAP</button>
                        ${inc.status !== 'ACKNOWLEDGED' 
                            ? `<button class="btn btn-ack" onclick="acknowledgeIncident('${inc.message_id}', event)">ACKNOWLEDGE</button>` 
                            : `<button class="btn btn-ack" disabled>ACKNOWLEDGED</button>`
                        }
                        <button class="btn btn-dispatch" onclick="dispatchIncident('${inc.message_id}', event)">DISPATCH</button>
                    </div>
                </div>
            </div>
        `;
    }

    async function fetchIncidents() {
        try {
            const res = await fetch('/api/incidents');
            if (!res.ok) return;
            const incidents = await res.json();
            
            if (incidents.length === 0) {
                incidentsListEl.innerHTML = '<div class="empty-state">No active incidents.</div>';
                return;
            }

            // Sort incidents by timestamp, newest first
            incidents.sort((a, b) => {
                const dateA = new Date(a.timestamp || 0);
                const dateB = new Date(b.timestamp || 0);
                return dateB - dateA; // Descending
            });

            incidentsListEl.innerHTML = incidents.map(createIncidentCard).join('');

            if (!map) return;

            const currentIds = new Set();
            incidents.forEach(inc => {
                const id = inc.message_id;
                currentIds.add(id);
                
                const lat = inc.latitude || inc.location?.lat;
                const lng = inc.longitude || inc.location?.lng;
                
                if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                    const color = getColorForPriority(inc.priority, inc.status);
                    const infoWindowContent = `
                        <div style="color: black;">
                            <strong>${inc.source_device_id}</strong><br>
                            Priority: ${inc.priority || 'LOW'}<br>
                            Msg: ${inc.message || 'Help requested.'}<br>
                            Updated: ${new Date().toLocaleTimeString()}
                        </div>
                    `;

                    if (markers[id]) {
                        markers[id].marker.setPosition({ lat, lng });
                        markers[id].marker.setIcon({
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: color,
                            fillOpacity: 0.8,
                            strokeColor: color,
                            strokeWeight: 2
                        });
                        markers[id].infoWindow.setContent(infoWindowContent);
                    } else {
                        const marker = new google.maps.Marker({
                            position: { lat, lng },
                            map: map,
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 8,
                                fillColor: color,
                                fillOpacity: 0.8,
                                strokeColor: color,
                                strokeWeight: 2
                            },
                            title: inc.source_device_id
                        });
                        const infoWindow = new google.maps.InfoWindow({ content: infoWindowContent });
                        marker.addListener('click', () => {
                            infoWindow.open({ anchor: marker, map });
                        });
                        markers[id] = { marker, infoWindow };
                    }
                }
            });

            Object.keys(markers).forEach(id => {
                if (!currentIds.has(id)) {
                    markers[id].marker.setMap(null);
                    delete markers[id];
                }
            });

        } catch (error) {
            console.error('Error fetching incidents:', error);
            if (incidentsListEl.children.length === 0 || incidentsListEl.querySelector('.empty-state')) {
                incidentsListEl.innerHTML = '<div class="empty-state" style="color: var(--accent-red)">Error loading incidents. Check connection.</div>';
            }
        }
    }

    fetchStats();
    fetchIncidents();
    setInterval(fetchStats, 3000);
    setInterval(fetchIncidents, 3000);
});
