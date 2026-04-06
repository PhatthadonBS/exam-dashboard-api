import express from "express"; // 1: import express
export const app = express();  // 2: define app is express
import cors from "cors"
import bodyParser from "body-parser";
import { identity } from "./controllers/identity.ctrl.js";
import { users } from "./controllers/ีusers.ctrl.js";

app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET","POST","PUT","DELETE"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));

app.use(bodyParser.text());
app.use(bodyParser.json());

app.use('/identity', identity)
app.use("/users", users)

app.use("/", (req, res) => {   // 3: root path
  res.send("Hello World!!!");
});