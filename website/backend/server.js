const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const {
    insertSOS, getSOSById, getAllSOS, updateSOSStatus,
    insertLocationUpdate, getLocationHistory, upsertDevice, getAllDevices,
    getStats, insertAuditLog, getAuditLogs,
    getAllNodes, getActiveNodeCount
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve the dashboard static files
app.use(express.static(path.join(__dirname, '../dashboard')));

// ─────────────────────────────────────────────
// SOS Endpoints
// ─────────────────────────────────────────────

// POST /api/sos — Receive an SOS message
app.post('/api/sos', async (req, res) => {
    const sosData = req.body;

    console.log(`[API] Received SOS: ${sosData.message_id} from ${sosData.source_device_id}`);

    try {
        // Check for duplicates
        const existing = await getSOSById(sosData.message_id);
        if (existing) {
            console.log(`[API] Duplicate SOS ${sosData.message_id}. Ignoring.`);
            return res.status(200).json({ status: 'ACKNOWLEDGED', message: 'Duplicate received' });
        }

        // Default status
        if (!sosData.status || sosData.status === 'CREATED') {
            sosData.status = 'PENDING';
        }

        await insertSOS({
            message_id: sosData.message_id,
            source_device_id: sosData.source_device_id,
            message: sosData.message || 'Emergency!',
            priority: sosData.priority || 'MEDIUM',
            latitude: sosData.latitude || 0,
            longitude: sosData.longitude || 0,
            location_accuracy: sosData.location_accuracy || 0,
            timestamp: sosData.timestamp || new Date().toISOString(),
            status: sosData.status,
            route: sosData.route || [],
            hopCount: sosData.hopCount || 0,
            gatewayId: sosData.gatewayId || null,
            ttl: sosData.ttl || null,
            battery: sosData.battery || null,
            type: sosData.type || null
        });

        // Audit log
        await insertAuditLog({
            action: 'SOS_RECEIVED',
            target_id: sosData.message_id,
            details: `Priority: ${sosData.priority} | From: ${sosData.source_device_id}`,
            performed_by: 'SYSTEM'
        });

        console.log(`[FIRESTORE] SOS ${sosData.message_id} saved.`);
        return res.status(200).json({ status: 'ACKNOWLEDGED' });
    } catch (err) {
        console.error(`[FIRESTORE] Error saving SOS:`, err.message);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});

// GET /api/incidents — Get all incidents
app.get('/api/incidents', async (req, res) => {
    try {
        const incidents = await getAllSOS();
        res.json(incidents);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sos/:id/acknowledge — Acknowledge an incident
app.post('/api/sos/:id/acknowledge', async (req, res) => {
    const id = req.params.id;

    try {
        const incident = await getSOSById(id);
        if (!incident) {
            return res.status(404).json({ success: false, message: 'Incident not found' });
        }

        await updateSOSStatus(id, 'ACKNOWLEDGED');

        await insertAuditLog({
            action: 'SOS_ACKNOWLEDGED',
            target_id: id,
            details: 'Incident acknowledged by rescue operator',
            performed_by: 'RESCUE_OPERATOR'
        });

        console.log(`[API] SOS ${id} acknowledged.`);
        res.json({ success: true, message: 'Incident acknowledged' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/sos/:id/dispatch — Dispatch rescue for an incident
app.post('/api/sos/:id/dispatch', async (req, res) => {
    const id = req.params.id;

    try {
        const incident = await getSOSById(id);
        if (!incident) {
            return res.status(404).json({ success: false, message: 'Incident not found' });
        }

        await updateSOSStatus(id, 'DISPATCHED');

        await insertAuditLog({
            action: 'RESCUE_DISPATCHED',
            target_id: id,
            details: 'Rescue team dispatched',
            performed_by: 'RESCUE_OPERATOR'
        });

        console.log(`[API] Rescue dispatched for SOS ${id}.`);
        res.json({ success: true, message: 'Rescue dispatched' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/sos/:id/location — Receive location update
app.post('/api/sos/:id/location', async (req, res) => {
    try {
        const id = req.params.id;
        const locationData = req.body;
        await insertLocationUpdate(id, locationData);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sos/:id/locations — Get location history
app.get('/api/sos/:id/locations', async (req, res) => {
    try {
        const id = req.params.id;
        const history = await getLocationHistory(id);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/devices — Register/update a device
app.post('/api/devices', async (req, res) => {
    try {
        await upsertDevice(req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/devices — Get all devices
app.get('/api/devices', async (req, res) => {
    try {
        const devices = await getAllDevices();
        res.json(devices);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ─────────────────────────────────────────────
// Stats & Monitoring
// ─────────────────────────────────────────────

// GET /api/stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await getStats();
        const nodeCount = await getActiveNodeCount();

        res.json({
            total: stats.total,
            critical: stats.critical,
            pending: stats.pending,
            acknowledged: stats.acknowledged,
            activeNodes: nodeCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/audit — Get audit logs
app.get('/api/audit', async (req, res) => {
    try {
        const logs = await getAuditLogs();
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/nodes — Get all nodes
app.get('/api/nodes', async (req, res) => {
    try {
        const nodes = await getAllNodes();
        res.json(nodes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
    console.log(`SANKET Backend Server running on http://0.0.0.0:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`Database: Firebase Firestore (sanket-emergency)`);
});
