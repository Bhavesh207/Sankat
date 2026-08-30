const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');

const {
    insertSOS, getSOSById, getAllSOS,
    getActiveSOS, getHistorySOS,
    updateSOSStatus, acknowledgeIncident, dispatchIncident, resolveIncident, reopenIncident,
    addIncidentEvent, getIncidentEvents,
    insertLocationUpdate, getLocationHistory,
    upsertDevice, getAllDevices,
    getStats, getExtendedStats,
    insertAuditLog, getAuditLogs,
    getAllNodes, getActiveNodeCount
} = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve dashboard static files
app.use(express.static(path.join(__dirname, '../dashboard')));

// ============================================================
// SOS RECEIVE — Android app sends here
// ============================================================

app.post('/api/sos', async (req, res) => {
    const sosData = req.body;
    console.log('[API] SOS received:', sosData.message_id, 'from', sosData.source_device_id);

    try {
        const existing = await getSOSById(sosData.message_id);
        if (existing) {
            console.log('[API] Duplicate SOS', sosData.message_id, '— ignoring.');
            return res.status(200).json({ status: 'ACKNOWLEDGED', message: 'Duplicate received' });
        }

        if (!sosData.status || ['CREATED', 'QUEUED', 'RELAYING', 'DELIVERED_TO_GATEWAY'].includes(sosData.status)) {
            sosData.status = 'PENDING';
        }

        await insertSOS({
            message_id:        sosData.message_id,
            source_device_id:  sosData.source_device_id,
            message:           sosData.message           || 'Emergency!',
            priority:          sosData.priority          || 'MEDIUM',
            latitude:          sosData.latitude          || 0,
            longitude:         sosData.longitude         || 0,
            location_accuracy: sosData.location_accuracy || 0,
            timestamp:         sosData.timestamp         || new Date().toISOString(),
            status:            sosData.status,
            route:             sosData.route    || [],
            hopCount:          sosData.hopCount || 0,
            gatewayId:         sosData.gatewayId || null,
            ttl:               sosData.ttl       || null,
            battery:           sosData.battery   || null,
            type:              sosData.type      || null
        });

        // Write first timeline event
        await addIncidentEvent(sosData.message_id, {
            eventType:      'SOS_RECEIVED',
            operatorId:     'SYSTEM',
            previousStatus: null,
            newStatus:      'PENDING',
            metadata:       {
                priority:  sosData.priority,
                source:    sosData.source_device_id,
                hopCount:  sosData.hopCount || 0,
                via:       sosData.route && sosData.route.length > 1 ? 'BLUETOOTH_RELAY' : 'DIRECT'
            }
        });

        await insertAuditLog({
            eventType:      'SOS_RECEIVED',
            incidentId:     sosData.message_id,
            deviceId:       sosData.source_device_id,
            operatorId:     'SYSTEM',
            newStatus:      'PENDING',
            details:        'Priority: ' + sosData.priority + ' | From: ' + sosData.source_device_id,
            metadata:       { hopCount: sosData.hopCount, route: sosData.route }
        });

        console.log('[FIRESTORE] SOS', sosData.message_id, 'saved.');
        return res.status(200).json({ status: 'ACKNOWLEDGED' });
    } catch (err) {
        console.error('[FIRESTORE] Error saving SOS:', err.message);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});

// ============================================================
// INCIDENTS — Dashboard queries
// ============================================================

// All incidents (kept for compatibility with Android InternetTransport)
app.get('/api/incidents', async (req, res) => {
    try {
        res.json(await getAllSOS());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ACTIVE only (Operations Center)
app.get('/api/incidents/active', async (req, res) => {
    try {
        res.json(await getActiveSOS());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// HISTORY — resolved/archived (Incident History panel)
// Query params: priority, status, search, dateFrom, dateTo
app.get('/api/incidents/history', async (req, res) => {
    try {
        const filters = {
            priority: req.query.priority || null,
            status:   req.query.status   || null,
            search:   req.query.search   || null,
            dateFrom: req.query.dateFrom || null,
            dateTo:   req.query.dateTo   || null
        };
        res.json(await getHistorySOS(filters));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single incident
app.get('/api/sos/:id', async (req, res) => {
    try {
        const inc = await getSOSById(req.params.id);
        if (!inc) return res.status(404).json({ error: 'Not found' });
        res.json(inc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// LIFECYCLE ACTIONS
// ============================================================

// ACKNOWLEDGE
app.post('/api/sos/:id/acknowledge', async (req, res) => {
    const id = req.params.id;
    const operatorId = req.body.operatorId || 'RESCUE_OPERATOR';
    try {
        const incident = await getSOSById(id);
        if (!incident) return res.status(404).json({ success: false, message: 'Not found' });
        if (!['PENDING', 'CREATED'].includes(incident.status)) {
            return res.status(400).json({ success: false, message: 'Cannot acknowledge from status: ' + incident.status });
        }

        await acknowledgeIncident(id, operatorId);

        await insertAuditLog({
            eventType:      'INCIDENT_ACKNOWLEDGED',
            incidentId:     id,
            deviceId:       incident.source_device_id,
            operatorId,
            previousStatus: incident.status,
            newStatus:      'ACKNOWLEDGED',
            details:        'Incident acknowledged'
        });

        console.log('[API] SOS', id, 'acknowledged by', operatorId);
        res.json({ success: true, message: 'Acknowledged' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DISPATCH
app.post('/api/sos/:id/dispatch', async (req, res) => {
    const id = req.params.id;
    const operatorId = req.body.operatorId || 'RESCUE_OPERATOR';
    try {
        const incident = await getSOSById(id);
        if (!incident) return res.status(404).json({ success: false, message: 'Not found' });

        await dispatchIncident(id, operatorId);

        await insertAuditLog({
            eventType:      'TEAM_DISPATCHED',
            incidentId:     id,
            deviceId:       incident.source_device_id,
            operatorId,
            previousStatus: incident.status,
            newStatus:      'DISPATCHED',
            details:        'Rescue team dispatched'
        });

        console.log('[API] Rescue dispatched for', id, 'by', operatorId);
        res.json({ success: true, message: 'Dispatched' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// RESOLVE
app.post('/api/sos/:id/resolve', async (req, res) => {
    const id = req.params.id;
    const operatorId = req.body.operatorId || 'RESCUE_OPERATOR';
    try {
        const incident = await getSOSById(id);
        if (!incident) return res.status(404).json({ success: false, message: 'Not found' });
        if (incident.status === 'RESOLVED') {
            return res.status(400).json({ success: false, message: 'Already resolved' });
        }

        await resolveIncident(id, operatorId);

        await insertAuditLog({
            eventType:      'INCIDENT_RESOLVED',
            incidentId:     id,
            deviceId:       incident.source_device_id,
            operatorId,
            previousStatus: incident.status,
            newStatus:      'RESOLVED',
            details:        'Incident resolved and closed'
        });

        console.log('[API] SOS', id, 'resolved by', operatorId);
        res.json({ success: true, message: 'Resolved' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// REOPEN
app.post('/api/sos/:id/reopen', async (req, res) => {
    const id = req.params.id;
    const operatorId = req.body.operatorId || 'RESCUE_OPERATOR';
    try {
        const incident = await getSOSById(id);
        if (!incident) return res.status(404).json({ success: false, message: 'Not found' });
        if (!['RESOLVED', 'ARCHIVED', 'CANCELLED'].includes(incident.status)) {
            return res.status(400).json({ success: false, message: 'Can only reopen resolved/archived incidents' });
        }

        await reopenIncident(id, operatorId);

        await insertAuditLog({
            eventType:      'INCIDENT_REOPENED',
            incidentId:     id,
            deviceId:       incident.source_device_id,
            operatorId,
            previousStatus: incident.status,
            newStatus:      'PENDING',
            details:        'Incident reopened and moved back to active'
        });

        console.log('[API] SOS', id, 'reopened by', operatorId);
        res.json({ success: true, message: 'Reopened' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// INCIDENT DETAIL
// ============================================================

// Get event timeline
app.get('/api/sos/:id/events', async (req, res) => {
    try {
        res.json(await getIncidentEvents(req.params.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Location updates
app.post('/api/sos/:id/location', async (req, res) => {
    try {
        await insertLocationUpdate(req.params.id, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/sos/:id/location-history', async (req, res) => {
    try {
        res.json(await getLocationHistory(req.params.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Alias for backward compatibility
app.get('/api/sos/:id/locations', async (req, res) => {
    try {
        res.json(await getLocationHistory(req.params.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DEVICES
// ============================================================

app.post('/api/devices', async (req, res) => {
    try {
        await upsertDevice(req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/devices', async (req, res) => {
    try {
        res.json(await getAllDevices());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// STATS
// ============================================================

app.get('/api/stats', async (req, res) => {
    try {
        const stats     = await getExtendedStats();
        const nodeCount = await getActiveNodeCount();
        res.json({ ...stats, activeNodes: nodeCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// AUDIT LOG — query params: eventType, incidentId, deviceId, dateFrom, dateTo
// ============================================================

app.get('/api/audit', async (req, res) => {
    try {
        const filters = {
            eventType:  req.query.eventType  || null,
            incidentId: req.query.incidentId || null,
            deviceId:   req.query.deviceId   || null,
            dateFrom:   req.query.dateFrom   || null,
            dateTo:     req.query.dateTo     || null
        };
        res.json(await getAuditLogs(filters));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// NODES
// ============================================================

app.get('/api/nodes', async (req, res) => {
    try {
        res.json(await getAllNodes());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Start Server
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('SANKET Backend Server running on http://0.0.0.0:' + PORT);
    console.log('Dashboard: http://localhost:' + PORT);
    console.log('Database: Firebase Firestore (sanket-emergency)');
});
