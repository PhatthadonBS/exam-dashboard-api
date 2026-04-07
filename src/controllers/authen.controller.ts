import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getUser } from "../utils/users.utils.js";
import { conn } from "../database/connect_db.js";

export const authen = Router();

authen.post("/sign-in", async (req: Request, res: Response) => {
    // const { email, passwd } = req.body as { email: string; passwd: string };
    // const user = await getUser();
    const user = { id: 1, email: "tenant@example.com", role: "user" };
    const payload = {
        userId: user.id,
        role: user.role,
    };
  
    // สร้าง JWT Token
    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET as string,
        { expiresIn: "1d" }, // กำหนดให้คีย์การ์ดหมดอายุใน 1 วัน
    );

    // ส่ง Token กลับไปให้ Angular
    res.json({
        success: true,
        message: "เข้าสู่ระบบสำเร็จ",
        token: token,
    });
});

authen.post("/sign-up", async ( req: Request, res: Response) => {
    
})
