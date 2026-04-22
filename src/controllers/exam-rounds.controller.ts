import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";
import { ResultSetHeader, RowDataPacket } from "mysql2";

export const examRounds = Router();

// ===================================================
// 1. ดึงข้อมูลรอบการสอบทั้งหมด (GET /)
// ===================================================
// ===================================================
// 1. ดึงข้อมูลรอบการสอบทั้งหมด (GET /)
// ===================================================
examRounds.get("/", async (req: Request, res: Response): Promise<void> => {
    try {
        // 📌 ปรับ SQL ใหม่: เพิ่ม er.round_status เข้ามาใน SELECT และ GROUP BY
        const sql = `
            SELECT 
                er.round_id, 
                er.academic_year, 
                er.round_type,
                er.round_number,
                er.round_status, -- 🌟 เพิ่มบรรทัดนี้ เพื่อให้ Angular รู้สถานะเปิด/ปิด
                COUNT(ec.subject_id) AS subjects_count
            FROM exam_rounds er
            LEFT JOIN exam_criteria ec ON er.round_id = ec.round_id
            GROUP BY er.round_id, er.academic_year, er.round_type, er.round_status -- 🌟 ต้องเพิ่มที่นี่ด้วย
            ORDER BY er.academic_year DESC, er.round_type ASC
        `;
        const [rows] = await conn.query<any[]>(sql);

        res.status(200).json({ 
            success: true, 
            data: rows 
        });
    } catch (error) {
        console.error("Error fetching exam rounds:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลรอบการสอบ", error });
    }
});
// ===================================================
// 2. สร้างรอบการสอบใหม่ (POST /)
// ===================================================
examRounds.post("/", async (req: Request, res: Response): Promise<void> => {
    const { academic_year, round_type, round_number } = req.body;

    if (!academic_year || !round_type) {
        res.status(400).json({ success: false, message: "กรุณาส่งข้อมูล ปีการศึกษา และ ชื่อรอบการสอบ ให้ครบถ้วน" });
        return;
    }
    try {
        const sql = `INSERT INTO exam_rounds (academic_year, round_type, round_number) VALUES (?, ?, ?)`;
        const [result] = await conn.query<any>(sql, [academic_year, round_type, round_number]);

        res.status(201).json({ 
            success: true, 
            message: "สร้างรอบการสอบสำเร็จ", 
            round_id: result.insertId 
        });
    } catch (error) {
        console.error("Error creating exam round:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการสร้างรอบการสอบ", error });
    }
});

// ===================================================
// 3. ลบรอบการสอบของปีนั้นๆ (DELETE /year/:year)
// ===================================================
examRounds.delete("/year/:year", async (req: Request, res: Response): Promise<void> => {
    const year = req.params.year;

    try {
        // ใช้ ON DELETE CASCADE ที่เราตั้งไว้ใน DB การลบรอบสอบ จะลบคะแนนของรอบนั้นไปด้วยอัตโนมัติ
        const sql = `DELETE FROM exam_rounds WHERE academic_year = ?`;
        const [result] = await conn.query<any>(sql, [year]);

        if (result.affectedRows === 0) {
            res.status(404).json({ success: false, message: `ไม่พบข้อมูลปีการศึกษา ${year} ที่ต้องการลบ` });
            return;
        }
 
        res.status(200).json({ 
            success: true, 
            message: `ลบข้อมูลปีการศึกษา ${year} เรียบร้อยแล้ว` 
        });
    } catch (error) {
        console.error("Error deleting exam rounds:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล", error });
    }
});

// =================================================================
// 🌟 API สำหรับเปิด/ปิดสถานะรอบการสอบ (Toggle Status)
// =================================================================
examRounds.put('/update-status/:id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.id;
  const { status } = req.body; // รับค่า 0 หรือ 1

  try {
    const sql = `UPDATE exam_rounds SET round_status = ? WHERE round_id = ?`;
    const [result] = await conn.query<ResultSetHeader>(sql, [status, roundId]);
    
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT round_status FROM exam_rounds WHERE round_id = ?`, [roundId]);
    return res.json({ newStatus: rows[0].round_status });
  } catch (error) {
    console.error("Update Status Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

