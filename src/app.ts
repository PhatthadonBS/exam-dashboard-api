import express from "express"; // 1: import express
export const app = express();  // 2: define app is express
import cors from "cors"
import bodyParser from "body-parser";
import { authen } from "./controllers/authen.controller.js";
import { users } from "./controllers/users.controller.js";

// middleware
app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET","POST","PUT","DELETE"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));

app.use(bodyParser.text());
app.use(bodyParser.json());

// path
app.use('/authen', authen)
app.use("/users", users)

// root
app.use("/", (req, res) => {   // 3: root path
  res.send("Hello World!!!");
});