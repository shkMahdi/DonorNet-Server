const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());  

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const database = client.db("donor-net");
    const requestCollection = database.collection("requests");

    console.log("Connected to MongoDB!");


    app.get('/api/requests', async (req, res) => {
      const query = {};

      if(req.query.requesterEmail){
        query.requesterEmail = req.query.requesterEmail;
      }

      const cursor = requestCollection.find(query);
      const requests = await cursor.toArray();
      res.send(requests);
    })

    // POST Route - Create Donation Request
    app.post('/api/requests', async (req, res) => {
      try {
        const request = req.body;
        const result = await requestCollection.insertOne(request);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to create request" });
      }
    });

  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Donor Net Server is running!');
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});