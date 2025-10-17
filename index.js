const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { ObjectId } = require("mongodb");
require("dotenv").config();

const clientPromise = require("./db"); // 👈 Mongo connection

const app = express();
const port = process.env.PORT || 3000;

// ✅ CORS settings
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://carbid-server.vercel.app",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// ✅ JWT Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized — No token found" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized — Invalid token" });
    }
    req.user = decoded;
    next();
  });
};

// ✅ Initialize after DB connection
async function init() {
  try {
    const client = await clientPromise;
    const bidsCollection = client.db("autobid").collection("bids");
    const allCollection = client.db("autobid").collection("allcars");

    // ==================== JWT ROUTES ====================
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

    // ==================== CAR ROUTES ====================
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
      const result = await allCollection.findOne({ _id: new ObjectId(id) });
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
          return res.status(403).send({ message: "Forbidden" });
        }
        const query = {
          $or: [{ seller_email: email }, { "buyer.email": email }],
        };
        const result = await allCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch cars" });
      }
    });

    app.delete("/car/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await allCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.put("/car/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedCar = req.body;
      if (!updatedCar.gallery_images) delete updatedCar.gallery_images;
      const result = await allCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedCar }
      );
      res.send(result);
    });

    // ==================== BIDS ====================
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
      const result = await bidsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    // ==================== ROOT ====================
    app.get("/", (req, res) => {
      res.send("🚀 AutoBid API — MongoDB Connected Successfully ✅");
    });

    // Optional test route
    app.get("/test-db", async (req, res) => {
      try {
        const client = await clientPromise;
        await client.db("admin").command({ ping: 1 });
        res.send({ status: "ok ✅" });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    });
  } catch (err) {
    console.error("❌ MongoDB Init Error:", err);
  }
}

init();

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
