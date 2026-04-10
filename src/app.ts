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

// middleware
app.use(cors({
  // 📌 1. เปลี่ยนเป็น Array [] และเพิ่ม http://localhost:4200 (Angular)
  origin: [
    "http://localhost:4200", 
    "https://examscoredashboard-2e4df.web.app/login"
  ],
  // 📌 2. เพิ่ม PATCH เข้าไปด้วย เพราะตอนอัปเดตข้อมูลหรือเปลี่ยนสถานะเราใช้ PATCH
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(bodyParser.text());
app.use(bodyParser.json());

// path
app.use('/authen', authen)
app.use("/users", users)
app.use("/scores", scores)
app.use("/subjects", subjects)
app.use("/exam-rounds", examRounds)
app.use("/exam-criteria", examCriteria)
app.use("/students", students)
app.use("/dashboard", dashboard) 
// root
app.use("/", (req, res) => {   // 3: root path
  res.send("Exam Dashboard API is running");
});