const express = require("express");
const cors = require("cors");
const { validationResult } = require("express-validator");
const connectDB = require("./config/database");
const authRoutes = require("./routes/authRoutes");

const app = express();

// Connect to database
connectDB();

// Middleware
app.use(
  cors({
    origin: true, // Allow all origins for development
    credentials: true,
  })
);
app.use(express.json());

const path = require("path");
// Serve uploaded files statically from /uploads
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// Validation middleware
app.use((req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
});

// Routes
app.use("/api/auth", authRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

module.exports = app;
