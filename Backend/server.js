const express = require("express");
require("dotenv").config();
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcrypt");
const app = express();
const path = require("path");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let waitingPlayer = null;

//connection with mongo db
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
//my collection
let usersCollection;
let factsCollection;
let gameSessionsCollection;
let multiplayerScoresCollection;

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");
    usersCollection = client.db("factsorfictions").collection("users");
    factsCollection = client.db("factsorfictions").collection("facts");
    gameSessionsCollection = client
      .db("factsorfictions")
      .collection("GameSessions");
    multiplayerScoresCollection = client
      .db("factsorfictions")
      .collection("MultiplayerScores");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
run().catch(console.dir);
// app use implementation
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));
app.use("/uploads", express.static("uploads")); //Setting Up a Static Folder
// middleware to authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  console.log("Token:", token);
  if (token == null) {
    console.log("Token is null");
    return res.sendStatus(401);
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log("Error during token verification:", err);
      return res.sendStatus(403);
    }
    req.user = user;
    console.log(req.user);
    next();
  });
}

//===============================Socket Io===============================================
const determineWinner = (
  player1Score,
  player2Score,
  player1Details,
  player2Details
) => {
  let winner;
  if (player1Score > player2Score) {
    winner = player1Details.firstName;
  } else if (player1Score < player2Score) {
    winner = player2Details.firstName;
  } else {
    winner = "It's a tie!";
  }
  return winner;
};

io.on("connection", (socket) => {
  const token = socket.handshake.query.token;
  if (!token) {
    console.log("No token provided.");
    return socket.disconnect(true);
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      console.log("Invalid token:", err);
      return socket.disconnect(true);
    }

    console.log("Decoded object:", decoded);
    const userId = decoded.id;
    if (!userId) {
      console.log("No userId in decoded object");
      return socket.disconnect(true);
    }

    socket.on("enterMatch", async () => {
      console.log("enterMatch event triggered by user:", userId);
      if (waitingPlayer) {
        console.log("Joining existing room:", waitingPlayer.room);
        socket.join(waitingPlayer.room);

        try {
          // Create a new game session in the database with the correct roomId and initial scores
          await gameSessionsCollection.insertOne({
            roomId: waitingPlayer.room,
            player1: waitingPlayer.userId,
            player2: userId,
            player1Score: 0,
            player2Score: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          console.log("New game session created");
        } catch (error) {
          console.error("Failed to create new game session:", error);
          // Handle error (you might emit an error event to the clients)
        }

        try {
          // Get the names of both the users to send in the 'matched' event
          const currentUser = await usersCollection.findOne({
            _id: new ObjectId(userId),
          });
          const waitingUser = await usersCollection.findOne({
            _id: new ObjectId(waitingPlayer.userId),
          });

          if (!currentUser || !waitingUser) {
            console.error("User not found.");
            return socket.disconnect(true);
          }

          console.log("Emitting 'matched' event to room with details:", {
            opponentName: currentUser.firstName,
            roomId: waitingPlayer.room,
          });
          socket.to(waitingPlayer.room).emit("matched", {
            opponentName: currentUser.firstName,
            roomId: waitingPlayer.room,
          });

          console.log("Emitting 'matched' event to self with details:", {
            opponentName: waitingUser.firstName,
            roomId: waitingPlayer.room,
          });

          socket.emit("matched", {
            opponentName: waitingUser.firstName,
            roomId: waitingPlayer.room,
          });
        } catch (error) {
          console.error("Failed to get usernames:", error);
          // Handle the error appropriately
        }

        waitingPlayer = null;
      } else {
        const room = `room-${userId}`;
        socket.join(room);
        waitingPlayer = { userId, room, socketId: socket.id };

        console.log("Emitting 'waiting' event with details:", {
          message: "Waiting for other user to join the room",
          roomId: room,
        });

        socket.emit("waiting", {
          message: "Waiting for other user to join the room",
          roomId: room,
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("disconnect event triggered by user:", userId);
      if (waitingPlayer && waitingPlayer.socketId === socket.id) {
        console.log("Waiting player cleared as they have disconnected");
        waitingPlayer = null;
      }
    });

    socket.on("answer", async (data) => {
      console.log(
        "answer event triggered by user:",
        userId,
        "with data:",
        data
      );
      const roomId = data.roomId;
      const isCorrect = data.isCorrect;

      // Fetch current game session based on roomId
      const currentSession = await gameSessionsCollection.findOne({ roomId });
      console.log("Current game session fetched:", currentSession);

      if (!currentSession) {
        console.log("Game session not found, emitting error event");
        return socket.emit("error", { message: "Game session not found" });
      }

      // Update the player's score
      const fieldToUpdate =
        userId === currentSession.player1 ? "player1Score" : "player2Score";
      let newScore = currentSession[fieldToUpdate];
      if (isCorrect) {
        newScore += 1;
      } else {
        // Prevent the score from going below 0
        newScore = Math.max(0, newScore);
      }

      await gameSessionsCollection.updateOne(
        { roomId },
        { $set: { [fieldToUpdate]: newScore } }
      );
      console.log("Game session updated with new score");

      // Update multiplayerScoresCollection
      await multiplayerScoresCollection.updateOne(
        { gameId: roomId, playerId: userId },
        { $set: { score: newScore, updatedAt: new Date() } }
      );

      const totalQuestions = 10;
      if (
        currentSession.player1QuestionsAnswered >= totalQuestions ||
        currentSession.player2QuestionsAnswered >= totalQuestions
      ) {
        const player1Details = await usersCollection.findOne({
          _id: new ObjectId(currentSession.player1),
        });
        const player2Details = await usersCollection.findOne({
          _id: new ObjectId(currentSession.player2),
        });

        // Define winner using the determineWinner function
        const winner = determineWinner(
          currentSession.player1Score,
          currentSession.player2Score,
          player1Details,
          player2Details
        );

        // Emit the endGame event after winner is defined
        io.to(roomId).emit("endGame", {
          winner,
          player1Score: currentSession.player1Score,
          player2Score: currentSession.player2Score,
        });
      }

      console.log("Multiplayer scores collection updated with new score");

      console.log("Emitting scoreUpdate", { opponentScore: newScore });
      socket.to(roomId).emit("scoreUpdate", { opponentScore: newScore });

      console.log("Emitting scoreUpdate", { yourScore: newScore });
      socket.emit("scoreUpdate", { yourScore: newScore });
    });

    socket.on("endGame", async () => {
      console.log("endGame event triggered by user:", userId);
      const roomId = `room-${userId}`;

      const currentSession = await gameSessionsCollection.findOne({ roomId });
      console.log("Current game session fetched:", currentSession);

      if (!currentSession) {
        console.log("Game session not found for endGame event");
        return;
      }

      const player1Score = currentSession.player1Score;
      const player2Score = currentSession.player2Score;

      // Fetch user details
      const player1Details = await usersCollection.findOne({
        _id: new ObjectId(currentSession.player1),
      });
      const player2Details = await usersCollection.findOne({
        _id: new ObjectId(currentSession.player2),
      });

      if (!player1Details || !player2Details) {
        console.log("Could not fetch user details.");
        return;
      }

      let winner;
      if (player1Score > player2Score) {
        winner = player1Details.firstName;
      } else if (player1Score < player2Score) {
        winner = player2Details.firstName;
      } else {
        winner = "It's a tie!";
      }

      const winner1 = determineWinner(
        player1Score,
        player2Score,
        player1Details,
        player2Details
      );
      io.to(roomId).emit("endGame", { winner1, player1Score, player2Score });

      console.log("Determining the winner:", winner);

      console.log("Emitting endGame to room with data:", {
        winner,
        player1Score,
        player2Score,
      });

      socket.to(roomId).emit("endGame", { winner, player1Score, player2Score });
      console.log("Emitting endGame to self with data:", {
        winner,
        player1Score,
        player2Score,
      });
      socket.emit("endGame", { winner, player1Score, player2Score });
    });
  });
});

// -------------------------- Start Server Side----------------------------
//Configuring Multer’s Storage Settings
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage }); //Initializing multer:

app.post("/img", upload.single("image"), (req, res) => {
  if (req.file) {
    res.json({
      url: `http://localhost:${port}/uploads/${req.file.filename}`,
    });
  } else {
    res.status(400).send("File not uploaded.");
  }
});

//General api route
app.get("/", (req, res) => {
  res.send("This is the best project server");
});

//Get users api
app.get("/users", async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (error) {
    console.error("Failed to get users", error);
    res.sendStatus(500);
  }
});

//Get user by id api
app.get("/user/:id", async (req, res) => {
  if (!req.params.id || !req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).send("Invalid ID format");
  }

  try {
    const user = await usersCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (user) {
      res.json(user);
    } else {
      res.status(404).send("User not found.");
    }
  } catch (error) {
    console.error("Failed to get user", error);
    res.sendStatus(500);
  }
});

app.put("/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const { email, firstName, lastName, phone, avatar, isAdmin } = req.body;

    if (!email || !firstName || !lastName || !phone) {
      return res
        .status(400)
        .send("Please provide email, firstName, lastName and phone.");
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) }, // Only update approved facts
      { $set: { email, firstName, lastName, phone, isAdmin, avatar } }
    );

    res.json({ message: "User updated successfully." });
  } catch (error) {
    console.error("Error updating user info:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

//Sign up users api
app.post("/signup", async (req, res) => {
  console.log("Received signup data:", req.body);
  const {
    email,
    password,
    confirmPassword,
    firstName,
    lastName,
    phone,
    avatar,
    bio = "Hello there <3",
  } = req.body;

  //check if any of the fields are empty, if they are, there is an err
  if (
    !email ||
    !password ||
    !confirmPassword ||
    !firstName ||
    !lastName ||
    !phone
  ) {
    return res.status(400).send("Please fill in all the required fields.");
  }

  //check if email is valid with "@"
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).send("Please enter a valid email address.");
  }

  //check if password is between 6 and 30 characters, and includes one digit and one uppercase letter
  const passwordRegex = /^(?=.*\d)(?=.*[A-Z]).{6,30}$/;
  if (!passwordRegex.test(password)) {
    return res
      .status(400)
      .send(
        "Password must be between 6-30 characters, include at least one digit and one uppercase letter."
      );
  }

  //check if password and confirmPassword match
  if (password !== confirmPassword) {
    return res.status(400).send("Passwords do not match.");
  }

  //check if phone number contains only digits
  const phoneRegex = /^\d+$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).send("Phone number should only contain digits.");
  }
  //checking if email or phone already exists
  try {
    const existingUser = await usersCollection.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(400).send("Email or phone number already exists.");
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const user = {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      phone,
      bio,
      avatar,
      isAdmin: false,
    };
    console.log(user);
    const result = await usersCollection.insertOne(user);

    res.status(201).json({ userId: result.insertedId });
  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

//Log in api
app.post("/login", async (req, res) => {
  console.log("Received signup data:", req.body);
  const { email, password } = req.body;

  //check if these fields are full
  if (!email || !password) {
    return res.status(400).send("Please fill in all the required fields.");
  }
  //find user in db
  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(400).send("User does not exist.");
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).send("Incorrect password.");
    }

    //just to make sure it works, after pushing front end guys, I will fix all issues regarding server routes.
    console.log("User isAdmin:", user.isAdmin);

    const token = jwt.sign(
      { id: user._id.toString(), isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      {
        expiresIn: "48h",
      }
    );
    //server responds with the updated user data, but first it removes the password field to ensure that sensitive data is not exposed
    const { password: _, ...userWithoutPassword } = user;

    res.json({ userId: user._id.toString(), user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// add submited fact to db api, (post req)
app.post("/submit-fact", async (req, res) => {
  try {
    const {
      title,
      description,
      sourceLink,
      fullName,
      email,
      mobileNumber,
      type,
      category,
    } = req.body;

    // Validate that the required fields are present. Adjust validation as needed.
    if (!title || !description || !fullName || !email || !category) {
      return res.status(400).send("Please fill in all the required fields.");
    }

    const newFact = {
      title,
      description,
      sourceLink,
      fullName,
      email,
      mobileNumber,
      type,
      category,
      isApproved: false,
    };

    const result = await factsCollection.insertOne(newFact);

    res.status(201).json({ factId: result.insertedId });
  } catch (error) {
    console.error("Error submitting fact:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});
//add photo upload to fact; receive link from cloudinary on client, add that link to the edit fact form. users cant add images to protect us from unwanted images. just for admins.

app.post("/img", async (req, res) => {
  console.log(req.body);
  const { formData } = req.body;

  if (!req.files)
    return res.send(JSON.stringify({ message: "please upload an image!" }));

  try {
    console.log("called upload");
    const { file } = req.files;
    const cloudFile = await upload(file.tempFilePath);
    console.log(cloudFile);

    res.status(201).send(JSON.stringify({ url: cloudFile.url }));
  } catch (err) {
    console.error("something went wrong uploading image to cloud server:", err);
    res
      .status(500)
      .send("something went wrong with the cloud storage. Please try again.");
  }
});

// get unapproved facts
app.get("/unapproved-facts", async (req, res) => {
  try {
    const unapprovedFacts = await factsCollection
      .find({ isApproved: false })
      .toArray();
    res.json(unapprovedFacts);
  } catch (error) {
    console.error("Error fetching unapproved facts:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// get only approved facts
app.get("/approved-facts", async (req, res) => {
  try {
    const category = req.query.category;
    let query = { isApproved: true };
    if (category) {
      query.category = category;
    }

    const approvedFacts = await factsCollection.find(query).toArray();
    res.json(approvedFacts);
  } catch (error) {
    console.error("Error fetching approved facts:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

app.put("/approved-facts/:factId", async (req, res) => {
  try {
    const factId = req.params.factId;
    const { title, description, sourceLink, imgLink, category } = req.body;

    // Validate that the required fields are present. Adjust validation as needed.
    if (!title || !description || !sourceLink) {
      return res
        .status(400)
        .send("Please provide title, description, and sourceLink.");
    }

    await factsCollection.updateOne(
      { _id: new ObjectId(factId), isApproved: true }, // Only update approved facts
      { $set: { title, description, sourceLink, imgLink, category } }
    );

    res.json({ message: "Approved fact updated successfully." });
  } catch (error) {
    console.error("Error updating approved fact:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// update approval status api
app.put("/facts/:factId", async (req, res) => {
  try {
    const factId = req.params.factId;
    const { isApproved } = req.body;

    await factsCollection.updateOne(
      { _id: new ObjectId(factId) },
      { $set: { isApproved: isApproved } }
    );

    res.json({ message: "Fact approval status updated." });
  } catch (error) {
    console.error("Error updating fact approval status:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// delete a fact by its ID
app.delete("/facts/:factId", async (req, res) => {
  try {
    const factId = req.params.factId;

    await factsCollection.deleteOne({ _id: new ObjectId(factId) });

    res.json({ message: "Fact successfully deleted." });
  } catch (error) {
    console.error("Error deleting fact:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// post api to save user's score
app.post("/save-score", authenticateToken, async (req, res) => {
  try {
    const { userId, score } = req.body;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { score } }
    );
    console.log("UserId:", userId);
    console.log("Score:", score);
    console.log("Update Result:", result);

    if (result.matchedCount > 0) {
      res.status(200).send("Score updated successfully");
    } else {
      throw new Error("Failed to find user");
    }
  } catch (error) {
    console.error("Error saving score:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// get 5 users with the highest scores:
app.get("/top-scores", async (req, res) => {
  try {
    const topUsers = await usersCollection
      .find({})
      .sort({ score: -1 }) // Sorting in descending order
      .limit(5) // Getting only first 5 users
      .toArray(); // Converting to an array

    res.json(topUsers);
  } catch (error) {
    console.error("Error fetching top 5 scores:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

//delete user from leaderboard api
app.delete("/remove-user/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    await usersCollection.deleteOne({ _id: new ObjectId(userId) });
    res.json({ message: "User successfully deleted." });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

//add user to leaderboard api
app.post("/add-user", async (req, res) => {
  const { firstName, lastName, score } = req.body;
  try {
    const result = await usersCollection.insertOne({
      firstName,
      lastName,
      score,
    });
    res.json({ message: "User added successfully.", id: result.insertedId });
  } catch (error) {
    console.error("Error adding user:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

app.put("/update-score/:userId", async (req, res) => {
  const userId = req.params.userId;
  const { score } = req.body;

  try {
    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { score: score } }
    );
    res.json({ message: "Score updated successfully." });
  } catch (error) {
    console.error("Error updating score:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// game=====================================================
// Create a new game session
app.post("/startGame", async (req, res) => {
  const { player1, player2, questions } = req.body;
  const uniqueRoomId = new ObjectId().toHexString();
  try {
    const result = await gameSessionsCollection.insertOne({
      roomId: uniqueRoomId,
      player1,
      player2,
      questions,
      currentQuestion: 0,
      player1Score: 0,
      player2Score: 0,
      status: "active",
      createdAt: new Date(),
      endedAt: null,
    });
    res.json({
      message: "Game session created successfully.",
      id: result.insertedId,
      roomId: uniqueRoomId,
    });
  } catch (error) {
    console.error("Error creating game session:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

// Add multiplayer score
app.post("/updateScore", async (req, res) => {
  const { gameId, playerId, score } = req.body;
  try {
    const result = await multiplayerScoresCollection.updateOne(
      { gameId, playerId },
      { $set: { score, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ message: "Score updated successfully.", id: result.insertedId });
  } catch (error) {
    console.error("Error updating score:", error);
    res.status(500).send("Something went wrong. Please try again later.");
  }
});

app.get("/getScores/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const session = await gameSessionsCollection.findOne({ roomId });

    if (!session) {
      return res.status(404).send("Game session not found");
    }

    const { player1Score, player2Score } = session;

    res.json({ player1Score, player2Score });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

const port = 3082;
server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
