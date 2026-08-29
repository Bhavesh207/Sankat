const { db } = require('./db.js');

async function clearSOSHistory() {
    const sosRef = db.collection('sos_incidents');
    const snapshot = await sosRef.get();

    if (snapshot.empty) {
        console.log('No documents found in sos_incidents.');
        process.exit(0);
    }

    const batchSize = 100;
    let count = 0;
    
    // Batch delete
    const batches = [];
    let batch = db.batch();

    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        count++;
        if (count % batchSize === 0) {
            batches.push(batch.commit());
            batch = db.batch();
        }
    });

    if (count % batchSize !== 0) {
        batches.push(batch.commit());
    }

    await Promise.all(batches);
    console.log(`Successfully deleted ${count} incidents from sos_incidents collection.`);
    process.exit(0);
}

clearSOSHistory().catch(console.error);
