const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id
});

const db = getFirestore();

// Collections
const sosCollection = db.collection('sos_incidents');
const nodesCollection = db.collection('nodes');
const auditCollection = db.collection('audit_log');

// ─────────────────────────────────────────────
// SOS Incidents
// ─────────────────────────────────────────────

async function insertSOS(data) {
    await sosCollection.doc(data.message_id).set({
        ...data,
        route: data.route || [],
        hopCount: data.hopCount || 0,
        gatewayId: data.gatewayId || null,
        ttl: data.ttl || null,
        battery: data.battery || null,
        type: data.type || null,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp()
    });
}

async function getSOSById(messageId) {
    const doc = await sosCollection.doc(messageId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

async function getAllSOS() {
    const snapshot = await sosCollection.orderBy('created_at', 'desc').get();
    return snapshot.docs.map(doc => {
        const data = doc.data();
        // Convert Firestore Timestamps to ISO strings for JSON
        if (data.created_at && data.created_at.toDate) {
            data.created_at = data.created_at.toDate().toISOString();
        }
        if (data.updated_at && data.updated_at.toDate) {
            data.updated_at = data.updated_at.toDate().toISOString();
        }
        return { id: doc.id, ...data };
    });
}

async function updateSOSStatus(messageId, status) {
    await sosCollection.doc(messageId).update({
        status: status,
        updated_at: FieldValue.serverTimestamp()
    });
}

// ─────────────────────────────────────────────
// Location History
// ─────────────────────────────────────────────

async function insertLocationUpdate(sosId, locationData) {
    // Write to sos_incidents/{sosId}/locationHistory/{auto-id}
    await sosCollection.doc(sosId).collection('locationHistory').add({
        ...locationData,
        timestamp: FieldValue.serverTimestamp()
    });
    // Also update the main document's latest location
    await sosCollection.doc(sosId).update({
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        location_accuracy: locationData.accuracy || locationData.location_accuracy,
        updated_at: FieldValue.serverTimestamp()
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

// ─────────────────────────────────────────────
// Devices
// ─────────────────────────────────────────────

async function upsertDevice(deviceData) {
    // Write to devices/{deviceId}
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


// ─────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────

async function getStats() {
    const snapshot = await sosCollection.get();
    let total = 0, critical = 0, pending = 0, acknowledged = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        total++;
        if (data.priority && data.priority.toUpperCase() === 'CRITICAL') critical++;
        if (data.status === 'PENDING' || data.status === 'CREATED') pending++;
        if (data.status === 'ACKNOWLEDGED') acknowledged++;
    });

    return { total, critical, pending, acknowledged };
}

// ─────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────

async function insertAuditLog(data) {
    await auditCollection.add({
        ...data,
        timestamp: FieldValue.serverTimestamp()
    });
}

async function getAuditLogs() {
    const snapshot = await auditCollection.orderBy('timestamp', 'desc').limit(100).get();
    return snapshot.docs.map(doc => {
        const data = doc.data();
        if (data.timestamp && data.timestamp.toDate) {
            data.timestamp = data.timestamp.toDate().toISOString();
        }
        return { id: doc.id, ...data };
    });
}

// ─────────────────────────────────────────────
// Nodes
// ─────────────────────────────────────────────

async function getAllNodes() {
    const snapshot = await nodesCollection.orderBy('last_seen', 'desc').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getActiveNodeCount() {
    const snapshot = await nodesCollection.where('status', '==', 'ACTIVE').get();
    return snapshot.size;
}

module.exports = {
    db,
    insertSOS,
    getSOSById,
    getAllSOS,
    updateSOSStatus,
    insertLocationUpdate,
    getLocationHistory,
    upsertDevice,
    getAllDevices,
    getStats,
    insertAuditLog,
    getAuditLogs,
    getAllNodes,
    getActiveNodeCount
};
