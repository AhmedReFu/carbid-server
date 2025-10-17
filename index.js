const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const port = process.env.PORT || 3000;

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://agrotrade-a35fe.web.app",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access — No token found" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized access — Invalid token" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8k7klrr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const bidsCollection = client.db("autobid").collection("bids");
    const allCollection = client.db("autobid").collection("allcars");

    app.post("/jwt", async (req, res) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "3d",
        });
        res
          .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            maxAge: 3 * 24 * 60 * 60 * 1000,
          })
          .send({ success: true });
      } catch (error) {
        res.status(500).send({ success: false, message: "Failed to create token" });
      }
    });

    app.post("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        })
        .send({ success: true });
    });

    app.get("/all-cars", async (req, res) => {
      const { filter, page = 0, size = 4, search, sort } = req.query;
      let query = {};
      if (filter) query.brand_name = filter;
      if (search) {
        query.$or = [
          { model_name: { $regex: search, $options: "i" } },
          { brand_name: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
        ];
      }
      let sortOption = {};
      if (sort === "asc") sortOption = { deadline: 1 };
      else if (sort === "dsc") sortOption = { deadline: -1 };

      const result = await allCollection
        .find(query)
        .sort(sortOption)
        .skip(parseInt(page) * parseInt(size))
        .limit(parseInt(size))
        .toArray();

      res.send(result);
    });

    app.get("/cars-count", async (req, res) => {
      const { brand, search } = req.query;
      let query = {};
      if (brand) query.brand_name = brand;
      if (search) {
        query.$or = [
          { model_name: { $regex: search, $options: "i" } },
          { brand_name: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
        ];
      }
      const count = await allCollection.countDocuments(query);
      res.send({ count });
    });

    app.get("/cars", async (req, res) => {
      const result = await allCollection.find().toArray();
      res.send(result);
    });

    app.get("/car/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await allCollection.findOne(query);
      res.send(result);
    });

    app.post("/car", verifyToken, async (req, res) => {
      const carData = req.body;
      if (req.user?.email) {
        carData.seller_email = req.user.email;
      }
      const result = await allCollection.insertOne(carData);
      res.send(result);
    });

    app.get("/cars/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (req.user?.email !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
        const query = {
          $or: [{ seller_email: email }, { "buyer.email": email }],
        };
        const result = await allCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch posted cars" });
      }
    });

    app.delete("/car/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await allCollection.deleteOne(query);
      res.send(result);
    });

    app.put("/car/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedCar = req.body;
      if (!updatedCar.gallery_images) {
        delete updatedCar.gallery_images;
      }
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: updatedCar };
      const result = await allCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.post("/bid", verifyToken, async (req, res) => {
      const bidData = req.body;
      if (!bidData.bidder_email && bidData.email) {
        bidData.bidder_email = bidData.email;
      }
      const result = await bidsCollection.insertOne(bidData);
      res.send(result);
    });

    app.get("/my-bids/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { $or: [{ bidder_email: email }, { email: email }] };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/my-request/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { seller_email: email };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/bid/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status } };
      const result = await bidsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
  } catch (err) {
    console.error("MongoDB Error:", err);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to AutoBid API — Secure JWT Server Running.");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});