// db.js
const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8k7klrr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

if (!process.env.DB_USER || !process.env.DB_PASS) {
    throw new Error("❌ Missing DB_USER or DB_PASS in environment variables");
}

const options = {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
};

let client;
let clientPromise;

// ✅ Reuse connection in development
if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
        client = new MongoClient(uri, options);
        global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
} else {
    // ✅ New client for production (Vercel)
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
}

module.exports = clientPromise;
