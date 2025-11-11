require("dotenv").config();
const app = require("./app");
const http = require("http");
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Message = require("./models/Message");
const fetch = require("node-fetch");

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Store online users
const onlineUsers = new Map();

// Socket authentication middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return next(new Error("User not found"));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (error) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.userId}`);

  // Add user to online users
  onlineUsers.set(socket.userId, socket.id);

  // Update user's last seen to null (online now)
  User.findByIdAndUpdate(socket.userId, { lastSeen: null }, { new: true })
    .then((user) => {
      console.log(`User ${socket.userId} marked as online`);
    })
    .catch((err) => console.error("Error updating user online status:", err));

  // Join user's room for personal messages
  socket.join(socket.userId);

  // Notify other users that this user is online (with status info)
  socket.broadcast.emit("userOnline", {
    userId: socket.userId,
    isOnline: true,
    lastSeenText: "Online",
  });

  // Handle user coming online (when app comes to foreground)
  socket.on("userOnline", async () => {
    try {
      // Update user's last seen to null (online now)
      await User.findByIdAndUpdate(
        socket.userId,
        { lastSeen: null },
        { new: true }
      );

      // Update status of messages sent to this user
      await Message.updateMany(
        { to: socket.userId, status: { $in: ["sent", "delivered"] } },
        { status: "delivered", deliveredAt: new Date() }
      );

      // Notify other users that this user is online
      socket.broadcast.emit("userCameOnline", {
        userId: socket.userId,
        isOnline: true,
        lastSeenText: "Online",
      });

      console.log(`User ${socket.userId} came online`);
    } catch (error) {
      console.error("Error handling user online:", error);
    }
  });

  // Handle user going offline/background (when app goes to background)
  socket.on("userOffline", async () => {
    try {
      const lastSeen = new Date();

      // Update user's last seen time
      await User.findByIdAndUpdate(socket.userId, { lastSeen }, { new: true });

      // Notify other users that this user went offline with last seen time
      socket.broadcast.emit("userWentOffline", {
        userId: socket.userId,
        isOnline: false,
        lastSeen: lastSeen,
        lastSeenText: formatLastSeen(lastSeen),
      });

      console.log(`User ${socket.userId} went offline at ${lastSeen}`);
    } catch (error) {
      console.error("Error handling user offline:", error);
    }
  });

  // Handle joining a chat
  socket.on("joinChat", (data) => {
    const { otherUserId } = data;
    const chatKey = [socket.userId, otherUserId].sort().join("-");
    socket.join(chatKey);
    console.log(`User ${socket.userId} joined chat: ${chatKey}`);
  });

  // Handle sending message
  socket.on("sendMessage", async (data) => {
    try {
      const { to, message, messageId, replyTo, isForwarded, forwardedFrom } =
        data;
      const chatKey = [socket.userId, to].sort().join("-");

      // Save message to database
      const newMessage = new Message({
        from: socket.userId,
        to,
        message,
        replyTo: replyTo || null,
        isForwarded: isForwarded || false,
        forwardedFrom: forwardedFrom || null,
        chatKey,
        status: "sent",
      });

      await newMessage.save();

      // Populate forwardedFrom for response
      await newMessage.populate("forwardedFrom", "name avatarUrl");

      // Emit to sender
      socket.emit("messageSent", {
        messageId,
        dbId: newMessage._id,
        status: "sent",
      });

      // Emit to receiver if online
      const receiverSocketId = onlineUsers.get(to);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("receiveMessage", {
          id: newMessage._id,
          from: socket.userId,
          to,
          message,
          replyTo: newMessage.replyTo,
          isForwarded: newMessage.isForwarded,
          forwardedFrom: newMessage.forwardedFrom
            ? {
                id: newMessage.forwardedFrom._id,
                name: newMessage.forwardedFrom.name,
                avatarUrl: newMessage.forwardedFrom.avatarUrl,
              }
            : null,
          timestamp: newMessage.createdAt,
          status: "delivered",
          deliveredAt: new Date(),
        });

        // Update message status to delivered
        newMessage.status = "delivered";
        newMessage.deliveredAt = new Date();
        await newMessage.save();
      } else {
        // Receiver is offline — send push notifications to their registered tokens if enabled
        try {
          const receiverUser = await User.findById(to).select(
            "pushTokens name notifications"
          );
          // Check if notifications are enabled (default to true if not set)
          const pushEnabled =
            receiverUser.notifications?.pushNotifications !== false;
          const messageEnabled =
            receiverUser.notifications?.messageNotifications !== false;

          if (
            receiverUser &&
            receiverUser.pushTokens &&
            receiverUser.pushTokens.length > 0 &&
            pushEnabled &&
            messageEnabled
          ) {
            const title = `${socket.user.name || "New message"}`;
            const body =
              message.length > 80 ? message.substring(0, 77) + "..." : message;
            const pushData = { chatKey, from: socket.userId };
            // send push via Expo push service
            await sendExpoPushNotifications(
              receiverUser.pushTokens,
              title,
              body,
              pushData
            );
          }
        } catch (pushErr) {
          console.error("Error sending push notification:", pushErr);
        }
      }

      // Emit to chat room for real-time updates
      io.to(chatKey).emit("messageStatusUpdate", {
        messageId: newMessage._id,
        status: receiverSocketId ? "delivered" : "sent",
      });
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("messageError", {
        messageId: data.messageId,
        error: "Failed to send message",
      });
    }
  });

  // Handle message delivered
  socket.on("messageDelivered", async (data) => {
    try {
      const { messageId, from } = data;
      await Message.findByIdAndUpdate(messageId, {
        status: "delivered",
        deliveredAt: new Date(),
      });

      // Notify sender
      const senderSocketId = onlineUsers.get(from);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageStatusUpdate", {
          messageId,
          status: "delivered",
        });
      }
    } catch (error) {
      console.error("Error updating message status:", error);
    }
  });

  // Handle messages read
  socket.on("messagesRead", async (data) => {
    try {
      const { messageIds, from } = data;

      await Message.updateMany(
        { _id: { $in: messageIds }, to: socket.userId },
        { status: "read", readAt: new Date() }
      );

      // Notify sender
      const senderSocketId = onlineUsers.get(from);
      if (senderSocketId) {
        messageIds.forEach((messageId) => {
          io.to(senderSocketId).emit("messageStatusUpdate", {
            messageId,
            status: "read",
          });
        });
      }

      // Notify receiver's dashboard to update unread counts
      socket.emit("conversationUpdate", {
        userId: from,
        action: "messagesRead",
      });
    } catch (error) {
      console.error("Error updating messages to read:", error);
    }
  });

  // Handle delete message for me
  socket.on("deleteForMe", async (data) => {
    try {
      const { messageId } = data;
      const message = await Message.findById(messageId);

      if (!message) return;

      // Add user to deletedFor array
      if (!message.deletedFor.includes(socket.userId)) {
        message.deletedFor.push(socket.userId);
        await message.save();
      }

      // Emit to user's room
      socket.emit("messageDeleted", { messageId, chatKey: message.chatKey });
    } catch (error) {
      console.error("Error deleting message for me:", error);
    }
  });

  // Handle delete message for everyone
  socket.on("deleteForEveryone", async (data) => {
    try {
      const { messageId } = data;
      const message = await Message.findById(messageId);

      if (!message || message.from.toString() !== socket.userId) return;

      // Mark as deleted
      message.isDeleted = true;
      await message.save();

      // Get chat key and emit to both users
      const chatKey = message.chatKey;
      io.to(chatKey).emit("messageDeleted", { messageId, chatKey });
    } catch (error) {
      console.error("Error deleting message for everyone:", error);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.userId}`);
    const lastSeen = new Date();

    // Update user's last seen time
    User.findByIdAndUpdate(socket.userId, { lastSeen }, { new: true })
      .then(() => {
        console.log(`User ${socket.userId} last seen updated to ${lastSeen}`);
      })
      .catch((err) => console.error("Error updating last seen:", err));

    // Remove user from online users
    onlineUsers.delete(socket.userId);

    // Notify other users that this user is offline with proper last seen info
    socket.broadcast.emit("userOffline", {
      userId: socket.userId,
      isOnline: false,
      lastSeen: lastSeen,
      lastSeenText: formatLastSeen(lastSeen),
    });
  });
});

// Helper function to format last seen time - same as in controller
const formatLastSeen = (date) => {
  if (!date) return "Online";

  const now = new Date();
  const lastSeenDate = new Date(date);
  const diffMs = now - lastSeenDate;
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
    return lastSeenDate.toLocaleDateString();
  }
};

// Send push notifications via Expo Push API
const sendExpoPushNotifications = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return;

  // Expo recommends batching up to 100 messages
  const BATCH_SIZE = 100;
  const endpoint = "https://exp.host/--/api/v2/push/send";

  const chunks = [];
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    chunks.push(tokens.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    const messages = chunk.map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
    }));

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error("Expo push send failed:", resp.status, text);
      } else {
        const data = await resp.json();
        console.log("Expo push response:", data);
      }
    } catch (err) {
      console.error("Failed to send push notifications to Expo:", err);
    }
  }
};

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
