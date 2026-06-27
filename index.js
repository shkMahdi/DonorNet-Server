const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');
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

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer')) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.log(error);
    return res.status(401).send({ error: 'Invalid token' });
  }
};

const activeUserVerification = async (req, res, next) => {
  const user = req.user;
  if (user.status !== 'active') {
    return res.status(403).send({ error: 'User is not active' });
  }
  next();
}

const adminVerification = async (req, res, next) => {
  const user = req.user;
  if (user.role !== 'admin') {
    return res.status(403).send({ error: 'User is not an admin' });
  }
  next();
}

async function run() {
  try {
    await client.connect();
    const database = client.db("donor-net");
    const requestCollection = database.collection("requests");
    const usersCollection = database.collection("user");

    console.log("Connected to MongoDB!");

    // get all users
    app.get('/api/users', verifyToken, adminVerification, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // get requests by requesterEmail
    app.get('/api/requests', async (req, res) => {
      const query = {};

      if (req.query.requesterEmail) {
        query.requesterEmail = req.query.requesterEmail;
      }

      const cursor = requestCollection.find(query);
      const requests = await cursor.toArray();
      res.send(requests);
    })

    //get all request 
    app.get('/api/donation-requests', async (req, res) => {
      const result = await requestCollection.find().toArray();
      res.send(result);
    })

    //get request details
    app.get('/api/donation-requests/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const request = await requestCollection.findOne(query);
      res.send(request);
    })

    // POST Route - Create Donation Request
    app.post('/api/requests', verifyToken, activeUserVerification, async (req, res) => {
      try {
        const request = req.body;
        const result = await requestCollection.insertOne(request);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to create request" });
      }
    });


    // donate
    // PATCH - Donate to a request
    app.patch('/api/donation-requests/:id/donate', verifyToken, activeUserVerification, async (req, res) => {
      try {
        const id = req.params.id;
        const { donorName, donorEmail } = req.body;

        if (!donorName || !donorEmail) {
          return res.status(400).send({ error: 'Donor name and email are required' });
        }

        const query = { _id: new ObjectId(id) };
        const request = await requestCollection.findOne(query);

        if (!request) {
          return res.status(404).send({ error: 'Request not found' });
        }

        // prevent donating to a request that's already taken
        if (request.status !== 'pending') {
          return res.status(409).send({ error: 'This request is no longer available' });
        }

        const updateDoc = {
          $set: {
            status: 'in progress',
            donorName,
            donorEmail,
          },
        };

        const result = await requestCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Failed to process donation' });
      }
    });

    app.delete('/api/donation-requests/:id', verifyToken, activeUserVerification, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const request = await requestCollection.findOne(query);

        if (!request) {
          return res.status(404).send({ error: 'Request not found' });
        }

        // ownership check — only the person who created it can delete it
        if (request.requesterEmail !== req.user.email) {
          return res.status(403).send({ error: 'You are not authorized to delete this request' });
        }

        const result = await requestCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Failed to delete request' });
      }
    });

    app.patch('/api/donation-requests/:id/status', verifyToken, activeUserVerification, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        const allowedStatuses = ['done', 'canceled'];
        if (!allowedStatuses.includes(status)) {
          return res.status(400).send({ error: 'Invalid status value' });
        }

        const query = { _id: new ObjectId(id) };
        const request = await requestCollection.findOne(query);

        if (!request) {
          return res.status(404).send({ error: 'Request not found' });
        }

        // only the original requester can mark it done or cancel it
        if (request.requesterEmail !== req.user.email) {
          return res.status(403).send({ error: 'You are not authorized to update this request' });
        }

        // can only transition from 'in progress'
        if (request.status !== 'in progress') {
          return res.status(409).send({ error: 'Only requests that are in progress can be updated' });
        }

        const updateDoc = {
          $set: { status },
        };

        const result = await requestCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Failed to update request status' });
      }
    });

    app.patch('/api/users/:id', verifyToken, adminVerification, async (req, res) => {
      const { id } = req.params;
      const { role, status } = req.body;

      const updates = {};
      if (role) updates.role = role;
      if (status) updates.status = status;

      if (Object.keys(updates).length === 0) {
        return res.status(400).send({ error: 'No valid fields to update' });
      }

      updates.updatedAt = new Date();

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: 'User not found' });
      }

      res.send({ success: true, message: 'User updated successfully' });
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
  console.log(`Server running on port ${port}`);
});
