import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getUser, insertUser } from "../utils/users.utils.js";
import bcrypt from "bcrypt";

export const authen = Router();

authen.post("/sign-in", async (req: Request, res: Response) => {
  const { email, passwd } = req.body as { email: string; passwd: string };
  try {
    const users = await getUser(null, email);
    if (!users || users.length === 0) return res.status(401).json({
      message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    });
    const user = users[0];
    const payload = {
        userId: user.user_id,
        email: user.email,
        role: user.role,
    };
    const isMatch = await bcrypt.compare(passwd, user.passwd);
    if (!isMatch) {
      return res.status(401).json({
        message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
      });
    } 
    // สร้าง JWT Token โดยใช้ข้อมูล payload และ secret key จาก environment variable 
    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET as string,
        { expiresIn: "1d" }, // กำหนดให้คีย์การ์ดหมดอายุใน 1 วัน
    );

    // ส่ง Token กลับไปให้ Angular
    res.json({ payload, token });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
});

authen.post("/sign-up", async (req: Request, res: Response) => {
    const { email, passwd, role } = req.body as { email: string; passwd: string; role: number };
    try {
        // Hash the password
        const hashedPasswd = await bcrypt.hash(passwd, 10);
        
        const newUser = await insertUser({ email, passwd: hashedPasswd, role });

        if (!newUser) {
            return res.status(500).json({ message: "Failed to create user" });
        }
        
        res.status(201).json({ message: "User created successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});
