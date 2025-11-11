const express = require("express");
const { body } = require("express-validator");
const {
  signup,
  verifyOTP,
  login,
  getProfile,
  updateProfile,
  uploadAvatar,
  getAllUsers,
  getUserStatus,
  registerPushToken,
  getMessages,
  getConversations,
  markConversationAsRead,
  markConversationAsUnread,
  getNotificationPreferences,
  updateNotificationPreferences,
  pinMessage,
  unpinMessage,
  favouriteMessage,
  unfavouriteMessage,
  getFavouriteMessages,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Multer for file uploads
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "..", "public", "uploads"));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Signup route
router.post(
  "/signup",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  signup
);

// Verify OTP route
router.post(
  "/verify-otp",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("otp")
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP must be 6 digits"),
  ],
  verifyOTP
);

// Login route
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  login
);

// Get profile route (protected)
router.get("/profile", authMiddleware, getProfile);

// Get all users route (protected) - returns all users except current user
router.get("/users", authMiddleware, getAllUsers);

// Get user status (online/offline and last seen)
router.get("/status/:userId", authMiddleware, getUserStatus);

// Register push token for notifications
router.post("/push/register", authMiddleware, (req, res) =>
  registerPushToken(req, res)
);

// Get favourite messages (must come BEFORE /messages/:userId)
router.get("/messages/favourites", authMiddleware, getFavouriteMessages);

// Get messages between current user and another user
router.get("/messages/:userId", authMiddleware, getMessages);

// Get conversations summary for dashboard
router.get("/conversations", authMiddleware, getConversations);

// Mark conversation as read
router.put(
  "/conversations/:userId/read",
  authMiddleware,
  markConversationAsRead
);

// Mark conversation as unread
router.put(
  "/conversations/:userId/unread",
  authMiddleware,
  markConversationAsUnread
);

// Get notification preferences
router.get("/notifications", authMiddleware, getNotificationPreferences);

// Update notification preferences
router.put("/notifications", authMiddleware, updateNotificationPreferences);

// Pin a message
router.put("/messages/:messageId/pin", authMiddleware, pinMessage);

// Unpin a message
router.put("/messages/:messageId/unpin", authMiddleware, unpinMessage);

// Favourite a message
router.put("/messages/:messageId/favourite", authMiddleware, favouriteMessage);

// Unfavourite a message
router.put(
  "/messages/:messageId/unfavourite",
  authMiddleware,
  unfavouriteMessage
);

// Update profile route (protected)
router.put("/profile", authMiddleware, updateProfile);

// Upload avatar (multipart/form-data) - returns public URL and updates user
router.post("/avatar", authMiddleware, upload.single("avatar"), uploadAvatar);

module.exports = router;
