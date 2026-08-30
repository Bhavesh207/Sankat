const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id
});

const db = getFirestore();

// Collections
const sosCollection   = db.collection('sos_incidents');
const nodesCollection = db.collection('nodes');
const auditCollection = db.collection('audit_logs');

// Active statuses — shown on Operations Center
const ACTIVE_STATUSES   = ['PENDING', 'ACKNOWLEDGED', 'DISPATCHED'];
// Terminal statuses — shown in History
const HISTORY_STATUSES  = ['RESOLVED', 'ARCHIVED', 'CANCELLED', 'FAILED', 'EXPIRED'];

// ============================================================
// SOS Incidents — Insert / Get
// ============================================================

async function insertSOS(data) {
    await sosCollection.doc(data.message_id).set({
        ...data,
        route:     data.route     || [],
        hopCount:  data.hopCount  || 0,
        gatewayId: data.gatewayId || null,
        ttl:       data.ttl       || null,
        battery:   data.battery   || null,
        type:      data.type      || null,
        acknowledgedAt:  null,
        dispatchedAt:    null,
        resolvedAt:      null,
        operatorId:      null,
        responseTime:    null,
        resolutionTime:  null,
        created_at:   FieldValue.serverTimestamp(),
        updated_at:   FieldValue.serverTimestamp()
    });
}

async function getSOSById(messageId) {
    const doc = await sosCollection.doc(messageId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

async function getAllSOS() {
    const snapshot = await sosCollection.get();
    const results = snapshot.docs.map(doc => _convertDoc(doc));
    results.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return results;
}

// Only PENDING / ACKNOWLEDGED / DISPATCHED
async function getActiveSOS() {
    const snapshot = await sosCollection
        .where('status', 'in', ACTIVE_STATUSES)
        .get();
    const results = snapshot.docs.map(doc => _convertDoc(doc));
    // Sort newest first in JS (avoids needing a Firestore composite index)
    results.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return results;
}

// Only RESOLVED / ARCHIVED / CANCELLED etc — supports optional filters
async function getHistorySOS(filters = {}) {
    // Fetch all history statuses — filter/sort in JS to avoid composite index requirements
    const snapshot = await sosCollection.where('status', 'in', HISTORY_STATUSES).get();
    let results = snapshot.docs.map(doc => _convertDoc(doc));

    // Priority filter
    if (filters.priority) {
        results = results.filter(r => (r.priority || '').toUpperCase() === filters.priority.toUpperCase());
    }

    // Date range on resolvedAt — client side
    if (filters.dateFrom) {
        const from = new Date(filters.dateFrom).getTime();
        results = results.filter(r => r.resolvedAt && new Date(r.resolvedAt).getTime() >= from);
    }
    if (filters.dateTo) {
        const to = new Date(filters.dateTo).getTime() + 86400000;
        results = results.filter(r => r.resolvedAt && new Date(r.resolvedAt).getTime() <= to);
    }

    // Sort newest-resolved first
    results.sort((a, b) => new Date(b.resolvedAt || b.created_at || 0) - new Date(a.resolvedAt || a.created_at || 0));

    // Client-side filters for text search (Firestore doesn't support contains)
    if (filters.search) {
        const s = filters.search.toLowerCase();
        results = results.filter(r =>
            (r.message_id || '').toLowerCase().includes(s) ||
            (r.source_device_id || '').toLowerCase().includes(s)
        );
    }
    if (filters.status && HISTORY_STATUSES.includes(filters.status)) {
        results = results.filter(r => r.status === filters.status);
    }

    return results;
}

// ============================================================
// Status Updates
// ============================================================

async function updateSOSStatus(messageId, status) {
    await sosCollection.doc(messageId).update({
        status:     status,
        updated_at: FieldValue.serverTimestamp()
    });
}

async function acknowledgeIncident(messageId, operatorId) {
    const now = FieldValue.serverTimestamp();
    const doc = await getSOSById(messageId);

    // Calculate responseTime from creation
    let responseTime = null;
    if (doc && doc.created_at) {
        const createdMs = doc.created_at._seconds
            ? doc.created_at._seconds * 1000
            : new Date(doc.created_at).getTime();
        responseTime = Math.floor((Date.now() - createdMs) / 1000);
    }

    await sosCollection.doc(messageId).update({
        status:         'ACKNOWLEDGED',
        acknowledgedAt: now,
        operatorId:     operatorId || 'RESCUE_OPERATOR',
        responseTime:   responseTime,
        updated_at:     now
    });

    await addIncidentEvent(messageId, {
        eventType:      'INCIDENT_ACKNOWLEDGED',
        operatorId:     operatorId || 'RESCUE_OPERATOR',
        previousStatus: doc ? doc.status : 'PENDING',
        newStatus:      'ACKNOWLEDGED',
        metadata:       {}
    });
}

async function dispatchIncident(messageId, operatorId) {
    const now = FieldValue.serverTimestamp();
    const doc = await getSOSById(messageId);

    await sosCollection.doc(messageId).update({
        status:      'DISPATCHED',
        dispatchedAt: now,
        operatorId:  operatorId || 'RESCUE_OPERATOR',
        updated_at:  now
    });

    await addIncidentEvent(messageId, {
        eventType:      'TEAM_DISPATCHED',
        operatorId:     operatorId || 'RESCUE_OPERATOR',
        previousStatus: doc ? doc.status : 'ACKNOWLEDGED',
        newStatus:      'DISPATCHED',
        metadata:       {}
    });
}

async function resolveIncident(messageId, operatorId) {
    const now  = new Date();
    const doc  = await getSOSById(messageId);

    // Calculate resolution time from creation
    let resolutionTime = null;
    if (doc && doc.created_at) {
        const createdMs = doc.created_at._seconds
            ? doc.created_at._seconds * 1000
            : new Date(doc.created_at).getTime();
        resolutionTime = Math.floor((now.getTime() - createdMs) / 1000);
    }

    await sosCollection.doc(messageId).update({
        status:         'RESOLVED',
        resolvedAt:     Timestamp.fromDate(now),
        operatorId:     operatorId || 'RESCUE_OPERATOR',
        resolutionTime: resolutionTime,
        updated_at:     FieldValue.serverTimestamp()
    });

    await addIncidentEvent(messageId, {
        eventType:      'INCIDENT_RESOLVED',
        operatorId:     operatorId || 'RESCUE_OPERATOR',
        previousStatus: doc ? doc.status : 'DISPATCHED',
        newStatus:      'RESOLVED',
        metadata:       { resolutionTime }
    });
}

async function reopenIncident(messageId, operatorId) {
    const doc = await getSOSById(messageId);

    await sosCollection.doc(messageId).update({
        status:     'PENDING',
        resolvedAt: null,
        updated_at: FieldValue.serverTimestamp()
    });

    await addIncidentEvent(messageId, {
        eventType:      'INCIDENT_REOPENED',
        operatorId:     operatorId || 'RESCUE_OPERATOR',
        previousStatus: doc ? doc.status : 'RESOLVED',
        newStatus:      'PENDING',
        metadata:       {}
    });
}

// ============================================================
// Incident Event Timeline
// ============================================================

async function addIncidentEvent(incidentId, eventData) {
    await sosCollection.doc(incidentId).collection('events').add({
        ...eventData,
        incidentId,
        timestamp: FieldValue.serverTimestamp()
    });
}

async function getIncidentEvents(incidentId) {
    const snapshot = await sosCollection
        .doc(incidentId)
        .collection('events')
        .orderBy('timestamp', 'asc')
        .get();
    return snapshot.docs.map(doc => {
        const data = doc.data();
        if (data.timestamp && data.timestamp.toDate) {
            data.timestamp = data.timestamp.toDate().toISOString();
        }
        return { id: doc.id, ...data };
    });
}

// ============================================================
// Location History
// ============================================================

async function insertLocationUpdate(sosId, locationData) {
    await sosCollection.doc(sosId).collection('locationHistory').add({
        ...locationData,
        timestamp: FieldValue.serverTimestamp()
    });
    await sosCollection.doc(sosId).update({
        latitude:          locationData.latitude,
        longitude:         locationData.longitude,
        location_accuracy: locationData.accuracy || locationData.location_accuracy,
        updated_at:        FieldValue.serverTimestamp()
    });
}

async function getLocationHistory(sosId) {
    const snapshot = await sosCollection.doc(sosId)
        .collection('locationHistory')
        .orderBy('timestamp', 'asc')
        .get();
    return snapshot.docs.map(doc => {
        const data = doc.data();
        if (data.timestamp && data.timestamp.toDate) {
            data.timestamp = data.timestamp.toDate().toISOString();
        }
        return { id: doc.id, ...data };
    });
}

// ============================================================
// Devices
// ============================================================

async function upsertDevice(deviceData) {
    const devicesCollection = db.collection('devices');
    await devicesCollection.doc(deviceData.device_id).set({
        ...deviceData,
        last_seen: FieldValue.serverTimestamp()
    }, { merge: true });
}

async function getAllDevices() {
    const devicesCollection = db.collection('devices');
    const snapshot = await devicesCollection.orderBy('last_seen', 'desc').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============================================================
// Stats
// ============================================================

async function getStats() {
    const snapshot = await sosCollection.get();
    let total = 0, critical = 0, pending = 0, acknowledged = 0, active = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        total++;
        if ((data.priority || '').toUpperCase() === 'CRITICAL') critical++;
        if (data.status === 'PENDING' || data.status === 'CREATED') pending++;
        if (data.status === 'ACKNOWLEDGED') acknowledged++;
        if (ACTIVE_STATUSES.includes(data.status)) active++;
    });

    return { total, critical, pending, acknowledged, active };
}

async function getExtendedStats() {
    const snapshot = await sosCollection.get();
    const now = new Date();
    const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek  = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());

    let total = 0, critical = 0, pending = 0, acknowledged = 0, active = 0;
    let resolvedToday = 0, resolvedThisWeek = 0;
    let totalResponseTime = 0, responseCount = 0;
    let totalResolutionTime = 0, resolutionCount = 0;

    snapshot.forEach(doc => {
        const d = doc.data();
        total++;
        if ((d.priority || '').toUpperCase() === 'CRITICAL') critical++;
        if (d.status === 'PENDING' || d.status === 'CREATED') pending++;
        if (d.status === 'ACKNOWLEDGED') acknowledged++;
        if (ACTIVE_STATUSES.includes(d.status)) active++;

        if (d.status === 'RESOLVED' && d.resolvedAt) {
            const resolvedMs = d.resolvedAt._seconds
                ? d.resolvedAt._seconds * 1000
                : new Date(d.resolvedAt).getTime();
            if (resolvedMs >= startOfDay.getTime())  resolvedToday++;
            if (resolvedMs >= startOfWeek.getTime()) resolvedThisWeek++;
        }
        if (d.responseTime) { totalResponseTime += d.responseTime; responseCount++; }
        if (d.resolutionTime) { totalResolutionTime += d.resolutionTime; resolutionCount++; }
    });

    return {
        total, critical, pending, acknowledged, active,
        resolvedToday, resolvedThisWeek,
        avgResponseTime:   responseCount   > 0 ? Math.floor(totalResponseTime   / responseCount)   : null,
        avgResolutionTime: resolutionCount > 0 ? Math.floor(totalResolutionTime / resolutionCount) : null
    };
}

// ============================================================
// Audit Log
// ============================================================

async function insertAuditLog(data) {
    await auditCollection.add({
        eventId:        null,
        eventType:      data.action || data.eventType || 'UNKNOWN',
        incidentId:     data.target_id  || data.incidentId  || null,
        deviceId:       data.deviceId   || null,
        operatorId:     data.performed_by || data.operatorId || 'SYSTEM',
        previousStatus: data.previousStatus || null,
        newStatus:      data.newStatus      || null,
        details:        data.details        || null,
        metadata:       data.metadata       || {},
        timestamp:      FieldValue.serverTimestamp()
    });
}

async function getAuditLogs(filters = {}) {
    let query = auditCollection.orderBy('timestamp', 'desc').limit(200);

    const snapshot = await query.get();
    let results = snapshot.docs.map(doc => {
        const data = doc.data();
        if (data.timestamp && data.timestamp.toDate) {
            data.timestamp = data.timestamp.toDate().toISOString();
        }
        return { id: doc.id, ...data };
    });

    // Client-side filtering
    if (filters.eventType) {
        results = results.filter(r => r.eventType === filters.eventType);
    }
    if (filters.incidentId) {
        results = results.filter(r => (r.incidentId || '').toLowerCase().includes(filters.incidentId.toLowerCase()));
    }
    if (filters.deviceId) {
        results = results.filter(r => (r.deviceId || '').toLowerCase().includes(filters.deviceId.toLowerCase()));
    }
    if (filters.dateFrom) {
        const from = new Date(filters.dateFrom).getTime();
        results = results.filter(r => new Date(r.timestamp).getTime() >= from);
    }
    if (filters.dateTo) {
        const to = new Date(filters.dateTo).getTime() + 86400000;
        results = results.filter(r => new Date(r.timestamp).getTime() <= to);
    }

    return results;
}

// ============================================================
// Nodes
// ============================================================

async function getAllNodes() {
    const snapshot = await nodesCollection.orderBy('last_seen', 'desc').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getActiveNodeCount() {
    const snapshot = await nodesCollection.where('status', '==', 'ACTIVE').get();
    return snapshot.size;
}

// ============================================================
// Internal helpers
// ============================================================

function _convertDoc(doc) {
    const data = doc.data();
    const fields = ['created_at', 'updated_at', 'acknowledgedAt', 'dispatchedAt', 'resolvedAt'];
    fields.forEach(f => {
        if (data[f] && data[f].toDate) {
            data[f] = data[f].toDate().toISOString();
        }
    });
    return { id: doc.id, ...data };
}

module.exports = {
    db,
    insertSOS,
    getSOSById,
    getAllSOS,
    getActiveSOS,
    getHistorySOS,
    updateSOSStatus,
    acknowledgeIncident,
    dispatchIncident,
    resolveIncident,
    reopenIncident,
    addIncidentEvent,
    getIncidentEvents,
    insertLocationUpdate,
    getLocationHistory,
    upsertDevice,
    getAllDevices,
    getStats,
    getExtendedStats,
    insertAuditLog,
    getAuditLogs,
    getAllNodes,
    getActiveNodeCount
};
