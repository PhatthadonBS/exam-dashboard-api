import { Router, Request, Response } from "express";
import { verifyToken } from "../middlewares/authen.middleware.js";
import { conn } from "../config/connect_db.js";
import { ResultSetHeader } from "mysql2/promise";

export const students = Router();

/**
 * POST /students
 * API สำหรับการนำเข้ารายชื่อนิสิตแบบกลุ่ม (Bulk Insert)
 * รองรับทั้ง Array ของ String ["66...", "66..."] 
 * หรือ Array ของ Object [{std_code: "66..."}, ...]
 */
students.post("/", async (req: Request, res: Response): Promise<any> => {
    const body = req.body;
    let rawCodes: string[] = [];

    // 1. ดึงรหัสนิสิตออกจาก Payload ไม่ว่าจะมาในรูปแบบไหน
    if (Array.isArray(body)) {
        rawCodes = body
            .map((item) => {
                if (typeof item === "string") return item;
                if (item && typeof item === "object" && "std_code" in item) {
                    return String((item as { std_code: string }).std_code);
                }
                return "";
            })
            .map((code) => code.trim())
            .filter((code) => code.length > 0);
    }

    if (rawCodes.length === 0) {
        return res.status(400).json({ 
            success: false, 
            message: "กรุณาส่งข้อมูลรหัสนิสิตในรูปแบบ Array ที่ไม่ว่างเปล่า" 
        });
    }

    // 2. ตรวจสอบความถูกต้อง (ต้องเป็นตัวเลข 11 หลักตามมาตรฐาน มมส.)
    const validCodes = rawCodes.filter((code) => /^\d{11}$/.test(code));
    const invalidFormatCount = rawCodes.length - validCodes.length;

    if (validCodes.length === 0) {
        return res.status(400).json({ 
            success: false, 
            message: "ไม่พบรหัสนิสิตที่มีรูปแบบถูกต้อง (ต้องเป็นตัวเลข 11 หลัก)" 
        });
    }

    // เตรียมข้อมูลสำหรับ Bulk Insert: [[code1], [code2], ...]
    const values = validCodes.map((std_code) => [std_code]);

try {
        /**
         * 3. บันทึกลง Database
         * ใช้ IGNORE เพื่อให้ข้ามตัวที่ std_code ซ้ำ (Duplicate) ไปโดยไม่ทำให้ Query พัง
         * (หมายเหตุ: ตาราง students ต้องตั้ง std_code เป็น PRIMARY KEY หรือ UNIQUE)
         */
        const query = "INSERT IGNORE INTO students (std_code) VALUES ?"; 
        const [result] = await conn.query<ResultSetHeader>(query, [values]);
        
        // 4. ส่งผลลัพธ์กลับไปยัง Frontend (Angular/Ionic)
        res.status(201).json({
            success: true,
            message: `ประมวลผลเสร็จสิ้น: นำเข้าใหม่ ${result.affectedRows} รายการ`,
            insertedRows: result.affectedRows,
            skippedRows: validCodes.length - result.affectedRows, // จำนวนที่ซ้ำกับของเดิม
            invalidFormatCount: invalidFormatCount, // จำนวนที่รูปแบบรหัสผิด (ไม่ใช่ 11 หลัก)
            totalProcessed: rawCodes.length
        });

    } catch (error: any) {
        console.error("Bulk insert failed:", error);
        res.status(500).json({ 
            success: false, 
            message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์", 
            error: error?.message 
        });
    }
});
