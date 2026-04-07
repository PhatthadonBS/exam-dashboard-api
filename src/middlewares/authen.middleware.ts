import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// สร้าง Interface ขยาย Request ของ Express ให้รองรับตัวแปร user (ถ้าใช้ TypeScript ต้องทำแบบนี้ครับ)
export interface AuthRequest extends Request {
  user?: any;
}

export const verifyToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  // 1. ดึง Token มาจาก Header ที่ชื่อว่า 'Authorization'
  // รูปแบบที่ Angular จะส่งมาคือ "Bearer eyJhbGci..." เราเลยต้องตัดคำว่า Bearer ออก
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  // 2. ถ้าไม่มี Token ส่งมา (แปลว่ายังไม่ได้ Login หรือลักไก่เข้ามา)
  if (!token) {
    return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });
  }

  try {
    // 3. ตรวจสอบความถูกต้องของ Token (รปภ. เอาคีย์การ์ดไปแตะเครื่องสแกน)
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

    // 4. ถ้าผ่าน ให้เอาข้อมูลที่ถอดรหัสได้ (เช่น userId) ฝากไว้ใน req
    // เพื่อให้ Controller เอาไปใช้งานต่อได้
    req.user = decoded;

    // 5. เปิดประตูให้ Request เดินทางไปหา Controller ต่อ
    next();
  } catch (error) {
    // ถ้า Token ปลอม, ถูกแก้ไข, หรือหมดอายุ
    return res
      .status(403) 
      .json({ message: "Token ไม่ถูกต้องหรือหมดอายุการใช้งาน" });
  }
};
