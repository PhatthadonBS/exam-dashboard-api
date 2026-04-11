import express from "express"; // 1: import express
export const app = express();  // 2: define app is express
import cors from "cors"
import bodyParser from "body-parser";
import { authen } from "./controllers/authen.controller.js";
import { users } from "./controllers/users.controller.js";
import { scores } from "./controllers/scores.controller.js";
import { subjects } from "./controllers/subjects.controller.js";
import { examRounds } from "./controllers/exam-rounds.controller.js";
import { examCriteria } from "./controllers/exam-criteria.controller.js";
import { students } from "./controllers/students.controller.js";
import { dashboard } from "./controllers/dashboard.controller.js";
import { verifyToken } from "./middlewares/authen.middleware.js";

// middleware
app.use(cors({
  origin: [
    "http://localhost:4200", 
    `${process.env.DOMAIN_NAME}`
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(bodyParser.text());
app.use(bodyParser.json());

// path
app.use('/authen', authen)
app.use("/users",verifyToken, users)
app.use("/scores",verifyToken, scores)
app.use("/subjects",verifyToken, subjects)
app.use("/exam-rounds",verifyToken, examRounds)
app.use("/exam-criteria",verifyToken, examCriteria)
app.use("/students",verifyToken, students)
app.use("/dashboard", verifyToken, dashboard) 
// root
app.use("/", (req, res) => {   // 3: root path
  res.redirect(`${process.env.DOMAIN_NAME}`)
});