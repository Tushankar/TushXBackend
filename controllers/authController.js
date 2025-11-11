const User = require("../models/User");
const Message = require("../models/Message");
const jwt = require("jsonwebtoken");
const transporter = require("../config/email");
const generateOTP = require("../utils/otpGenerator");

const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user
    const user = new User({
      name,
      email,
      password,
      otp,
      otpExpires,
    });

    await user.save();

    // Send OTP email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "OTP Verification",
      text: `Your OTP for verification is: ${otp}. It will expire in 10 minutes.`,
    };

    await transporter.sendMail(mailOptions);

    res
      .status(201)
      .json({ message: "User created. Please verify your email with OTP." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "User already verified" });
    }

    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.isVerified) {
      return res
        .status(400)
        .json({ message: "Please verify your email first" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "Login successful",
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Register a device push token for the authenticated user
const registerPushToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Push token required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Add token if not already present
    if (!user.pushTokens) user.pushTokens = [];
    if (!user.pushTokens.includes(token)) {
      user.pushTokens.push(token);
      await user.save();
    }

    res.json({ message: "Push token registered" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "-password -otp -otpExpires"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
        bio: user.bio || "Hey there! I am using WhatsApp.",
        isVerified: user.isVerified,
        pinned: user.pinned || [],
        archived: user.archived || [],
        favourites: user.favourites || [],
        locked: user.locked || [],
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    // Fetch all users except current user
    const users = await User.find({ _id: { $ne: currentUserId } })
      .select("-password -otp -otpExpires")
      .sort({ name: 1 });

    res.json({
      users: users.map((user) => {
        const isOnline = user.lastSeen === null;
        return {
          _id: user._id,
          id: user._id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl || null,
          bio: user.bio || "Hey there! I am using WhatsApp.",
          isVerified: user.isVerified,
          createdAt: user.createdAt,
          isOnline: isOnline,
          lastSeen: isOnline ? null : user.lastSeen,
          lastSeenText: isOnline ? "Online" : formatLastSeen(user.lastSeen),
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("lastSeen");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isOnline = user.lastSeen === null;

    res.json({
      userId,
      isOnline,
      lastSeen: user.lastSeen,
      lastSeenText: isOnline ? "Online" : formatLastSeen(user.lastSeen),
      lastSeenFormatted: isOnline
        ? "Online"
        : formatLastSeenDetailed(user.lastSeen),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Helper function to format last seen time
const formatLastSeen = (date) => {
  if (!date) return "Online";

  const now = new Date();
  const lastSeen = new Date(date);
  const diffMs = now - lastSeen;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    // Return formatted date
    return lastSeen.toLocaleDateString();
  }
};

const formatLastSeenDetailed = (date) => {
  if (!date) return "Online";

  const now = new Date();
  const lastSeen = new Date(date);
  const diffMs = now - lastSeen;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return "Just now";
  } else if (diffMins < 60) {
    return `Last seen ${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `Last seen ${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else if (diffDays < 7) {
    return `Last seen ${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  } else {
    // Return formatted date and time
    const options = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    return `Last seen ${lastSeen.toLocaleDateString("en-US", options)}`;
  }
};

const uploadAvatar = async (req, res) => {
  try {
    // multer stores the file on disk and attaches file info to req.file
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const avatarUrl = `${req.protocol}://${req.get("host")}/uploads/${
      req.file.filename
    }`;

    // Update user's avatarUrl in DB
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { avatarUrl },
      { new: true }
    ).select("-password -otp -otpExpires");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Avatar uploaded successfully",
      avatarUrl,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
        bio: user.bio || "Hey there! I am using WhatsApp.",
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, bio, avatarUrl, pinned, archived, favourites, locked } =
      req.body;
    console.log("updateProfile called for user:", req.user && req.user.userId);
    console.log("updateProfile body:", req.body);
    const userId = req.user.userId;

    // Validate input
    if (name && (name.length < 1 || name.length > 50)) {
      return res
        .status(400)
        .json({ message: "Name must be between 1 and 50 characters" });
    }

    if (bio && bio.length > 139) {
      return res
        .status(400)
        .json({ message: "Bio must be less than 140 characters" });
    }

    // Update user
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (bio !== undefined) updateData.bio = bio.trim();
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (pinned !== undefined) updateData.pinned = pinned;
    if (archived !== undefined) updateData.archived = archived;
    if (favourites !== undefined) updateData.favourites = favourites;
    if (locked !== undefined) updateData.locked = locked;

    console.log("updateProfile - updateData prepared:", updateData);

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select("-password -otp -otpExpires");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl || null,
        bio: user.bio || "Hey there! I am using WhatsApp.",
        isVerified: user.isVerified,
        pinned: user.pinned || [],
        archived: user.archived || [],
        favourites: user.favourites || [],
        locked: user.locked || [],
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getMessages = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const otherUserId = req.params.userId;

    // Validate that other user exists
    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get chat key
    const chatKey = [currentUserId, otherUserId].sort().join("-");

    // Fetch messages for this chat, excluding deleted ones for current user
    const messages = await Message.find({
      chatKey,
      isDeleted: false,
      deletedFor: { $ne: currentUserId },
    })
      .populate("from", "name avatarUrl")
      .populate("to", "name avatarUrl")
      .populate("forwardedFrom", "name avatarUrl")
      .populate({
        path: "replyTo",
        populate: [
          { path: "from", select: "name avatarUrl" },
          { path: "to", select: "name avatarUrl" },
        ],
      })
      .sort({ pinned: -1, createdAt: 1 }); // Pinned messages first, then by timestamp

    res.json({
      messages: messages.map((msg) => ({
        id: msg._id,
        from: msg.from._id,
        to: msg.to._id,
        message: msg.message,
        isForwarded: msg.isForwarded || false,
        forwardedFrom: msg.forwardedFrom
          ? {
              id: msg.forwardedFrom._id,
              name: msg.forwardedFrom.name,
              avatarUrl: msg.forwardedFrom.avatarUrl,
            }
          : null,
        replyTo: msg.replyTo
          ? {
              id: msg.replyTo._id,
              from: msg.replyTo.from._id,
              to: msg.replyTo.to._id,
              message: msg.replyTo.message,
              timestamp: msg.replyTo.createdAt,
              fromUser: {
                id: msg.replyTo.from._id,
                name: msg.replyTo.from.name,
                avatarUrl: msg.replyTo.from.avatarUrl,
              },
              toUser: {
                id: msg.replyTo.to._id,
                name: msg.replyTo.to.name,
                avatarUrl: msg.replyTo.to.avatarUrl,
              },
            }
          : null,
        timestamp: msg.createdAt,
        status: msg.status,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
        pinned: msg.pinned,
        favourite: msg.favourite,
        fromUser: {
          id: msg.from._id,
          name: msg.from.name,
          avatarUrl: msg.from.avatarUrl,
        },
        toUser: {
          id: msg.to._id,
          name: msg.to.name,
          avatarUrl: msg.to.avatarUrl,
        },
      })),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getConversations = async (req, res) => {
  try {
    const currentUserId = req.user.userId;

    // Find all unique chat partners by looking at messages where current user is sender or receiver
    const chatPartners = await Message.distinct("from", {
      to: currentUserId,
      isDeleted: false,
      deletedFor: { $ne: currentUserId },
    });

    const chatPartnersTo = await Message.distinct("to", {
      from: currentUserId,
      isDeleted: false,
      deletedFor: { $ne: currentUserId },
    });

    // Combine and deduplicate
    const allPartners = [
      ...new Set([...chatPartners, ...chatPartnersTo]),
    ].filter((id) => id.toString() !== currentUserId);

    const conversations = [];

    for (const partnerId of allPartners) {
      const chatKey = [currentUserId, partnerId].sort().join("-");

      // Get the last message in this conversation
      const lastMessage = await Message.findOne({
        chatKey,
        isDeleted: false,
        deletedFor: { $ne: currentUserId },
      })
        .populate("from", "name")
        .populate("to", "name")
        .sort({ createdAt: -1 })
        .limit(1);

      if (lastMessage) {
        // Count unread messages (messages from partner that are not read)
        const unreadCount = await Message.countDocuments({
          chatKey,
          from: partnerId,
          to: currentUserId,
          status: { $ne: "read" },
          isDeleted: false,
          deletedFor: { $ne: currentUserId },
        });

        conversations.push({
          userId: partnerId,
          lastMessage: lastMessage.message,
          lastMessageTime: lastMessage.createdAt,
          unseenCount: unreadCount,
        });
      }
    }

    res.json({
      conversations,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const markConversationAsRead = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userId } = req.params;

    // Validate that other user exists
    const otherUser = await User.findById(userId);
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const chatKey = [currentUserId, userId].sort().join("-");

    // Update all messages from other user to current user that are not read
    await Message.updateMany(
      {
        chatKey,
        from: userId,
        to: currentUserId,
        status: { $ne: "read" },
        isDeleted: false,
        deletedFor: { $ne: currentUserId },
      },
      {
        status: "read",
        readAt: new Date(),
      }
    );

    res.json({ message: "Conversation marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const markConversationAsUnread = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userId } = req.params;

    // Validate that other user exists
    const otherUser = await User.findById(userId);
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const chatKey = [currentUserId, userId].sort().join("-");

    // Find the last message from other user to current user
    const lastMessage = await Message.findOne({
      chatKey,
      from: userId,
      to: currentUserId,
      isDeleted: false,
      deletedFor: { $ne: currentUserId },
    }).sort({ createdAt: -1 });

    if (lastMessage) {
      // Mark the last message as delivered (not read)
      await Message.findByIdAndUpdate(lastMessage._id, {
        status: "delivered",
        readAt: null,
      });
    }

    res.json({ message: "Conversation marked as unread" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get notification preferences for the authenticated user
const getNotificationPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("notifications");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      notifications: user.notifications || {
        messageNotifications: true,
        callNotifications: true,
        pushNotifications: true,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update notification preferences for the authenticated user
const updateNotificationPreferences = async (req, res) => {
  try {
    const { messageNotifications, callNotifications, pushNotifications } =
      req.body;

    // Validate input
    if (
      typeof messageNotifications !== "boolean" ||
      typeof callNotifications !== "boolean" ||
      typeof pushNotifications !== "boolean"
    ) {
      return res.status(400).json({
        message: "All notification preferences must be boolean values",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      {
        notifications: {
          messageNotifications,
          callNotifications,
          pushNotifications,
        },
      },
      { new: true }
    ).select("notifications");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Notification preferences updated successfully",
      notifications: user.notifications,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Pin a message
const pinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if user is part of this conversation
    if (
      message.from.toString() !== userId &&
      message.to.toString() !== userId
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to pin this message" });
    }

    message.pinned = true;
    await message.save();

    res.json({ message: "Message pinned successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Unpin a message
const unpinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if user is part of this conversation
    if (
      message.from.toString() !== userId &&
      message.to.toString() !== userId
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to unpin this message" });
    }

    message.pinned = false;
    await message.save();

    res.json({ message: "Message unpinned successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Favourite a message
const favouriteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if user is part of this conversation
    if (
      message.from.toString() !== userId &&
      message.to.toString() !== userId
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to favourite this message" });
    }

    message.favourite = true;
    await message.save();

    res.json({ message: "Message favourited successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Unfavourite a message
const unfavouriteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if user is part of this conversation
    if (
      message.from.toString() !== userId &&
      message.to.toString() !== userId
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to unfavourite this message" });
    }

    message.favourite = false;
    await message.save();

    res.json({ message: "Message unfavourited successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get favourite messages
const getFavouriteMessages = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    console.log("getFavouriteMessages called for user:", currentUserId);

    if (!currentUserId) {
      console.error("No userId found in request");
      return res.status(401).json({ message: "Unauthorized - no user ID" });
    }

    // Fetch favourite messages where current user is sender or receiver
    const messages = await Message.find({
      $or: [{ from: currentUserId }, { to: currentUserId }],
      favourite: true,
      isDeleted: false,
      deletedFor: { $ne: currentUserId },
    })
      .populate("from", "name avatarUrl")
      .populate("to", "name avatarUrl")
      .lean() // Use lean() to get plain JS objects
      .sort({ createdAt: -1 });

    console.log("Found", messages.length, "favourite messages");

    // Filter out messages where population failed
    const validMessages = messages.filter((msg) => msg.from && msg.to);
    console.log("Valid messages after filtering:", validMessages.length);

    // Map to response format
    const responseMessages = validMessages.map((msg) => {
      try {
        const result = {
          id: msg._id ? msg._id.toString() : "",
          from: msg.from && msg.from._id ? msg.from._id.toString() : "",
          to: msg.to && msg.to._id ? msg.to._id.toString() : "",
          message: msg.message ? msg.message.toString() : "",
          replyTo: null,
          timestamp: msg.createdAt
            ? msg.createdAt.toISOString
              ? msg.createdAt.toISOString()
              : msg.createdAt
            : new Date().toISOString(),
          status: msg.status ? msg.status.toString() : "sent",
          deliveredAt: msg.deliveredAt
            ? msg.deliveredAt.toISOString
              ? msg.deliveredAt.toISOString()
              : msg.deliveredAt
            : null,
          readAt: msg.readAt
            ? msg.readAt.toISOString
              ? msg.readAt.toISOString()
              : msg.readAt
            : null,
          pinned: Boolean(msg.pinned),
          favourite: Boolean(msg.favourite),
          fromUser: msg.from
            ? {
                id: msg.from._id ? msg.from._id.toString() : "",
                name: msg.from.name ? msg.from.name.toString() : "Unknown",
                avatarUrl: msg.from.avatarUrl
                  ? msg.from.avatarUrl.toString()
                  : null,
              }
            : null,
          toUser: msg.to
            ? {
                id: msg.to._id ? msg.to._id.toString() : "",
                name: msg.to.name ? msg.to.name.toString() : "Unknown",
                avatarUrl: msg.to.avatarUrl
                  ? msg.to.avatarUrl.toString()
                  : null,
              }
            : null,
        };
        return result;
      } catch (mapErr) {
        console.error("Error mapping individual message:", msg._id, mapErr);
        throw mapErr;
      }
    });

    console.log("Sending response with", responseMessages.length, "messages");
    res.json({ messages: responseMessages });
  } catch (error) {
    console.error("Error in getFavouriteMessages:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
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
};
