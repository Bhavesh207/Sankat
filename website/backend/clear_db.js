const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
async function deleteCollection(collectionPath) {
    const collectionRef = db.collection(collectionPath);
    const snapshot = await collectionRef.get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => { batch.delete(doc.ref); });
    await batch.commit();
    console.log('Cleared ' + collectionPath);
}
async function clearAll() {
    await deleteCollection('sos_incidents');
    await deleteCollection('audit_log');
    await deleteCollection('nodes');
    console.log('All test data removed successfully.');
}
clearAll();
