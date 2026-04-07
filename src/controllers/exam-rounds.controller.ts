import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";

export const examRounds = Router();

// ===================================================
// 1. ดึงข้อมูลรอบการสอบทั้งหมด (GET /)
// ===================================================
examRounds.get("/", async (req: Request, res: Response): Promise<void> => {
    const connection = await conn.getConnection();
    try {
        // 📌 ปรับ SQL ใหม่: ใช้ LEFT JOIN ไปนับจำนวนวิชาในเกณฑ์สอบ (exam_criteria) มาด้วย
        const sql = `
            SELECT 
                er.round_id, 
                er.academic_year, 
                er.round_type,
                COUNT(ec.subject_id) AS subjects_count
            FROM exam_rounds er
            LEFT JOIN exam_criteria ec ON er.round_id = ec.round_id
            GROUP BY er.round_id, er.academic_year, er.round_type
            ORDER BY er.academic_year DESC, er.round_type ASC
        `;
        const [rows] = await connection.query<any[]>(sql);

        res.status(200).json({ 
            success: true, 
            data: rows 
        });
    } catch (error) {
        console.error("Error fetching exam rounds:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลรอบการสอบ", error });
    } finally {
        connection.release();
    }
});
// ===================================================
// 2. สร้างรอบการสอบใหม่ (POST /)
// ===================================================
examRounds.post("/", async (req: Request, res: Response): Promise<void> => {
    const { academic_year, round_type } = req.body;

    if (!academic_year || !round_type) {
        res.status(400).json({ success: false, message: "กรุณาส่งข้อมูล ปีการศึกษา และ ชื่อรอบการสอบ ให้ครบถ้วน" });
        return;
    }

    const connection = await conn.getConnection();
    try {
        const sql = `INSERT INTO exam_rounds (academic_year, round_type) VALUES (?, ?)`;
        const [result] = await connection.query<any>(sql, [academic_year, round_type]);

        res.status(201).json({ 
            success: true, 
            message: "สร้างรอบการสอบสำเร็จ", 
            round_id: result.insertId 
        });
    } catch (error) {
        console.error("Error creating exam round:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการสร้างรอบการสอบ", error });
    } finally {
        connection.release();
    }
});

// ===================================================
// 3. ลบรอบการสอบของปีนั้นๆ (DELETE /year/:year)
// ===================================================
examRounds.delete("/year/:year", async (req: Request, res: Response): Promise<void> => {
    const year = req.params.year;
    const connection = await conn.getConnection();

    try {
        // ใช้ ON DELETE CASCADE ที่เราตั้งไว้ใน DB การลบรอบสอบ จะลบคะแนนของรอบนั้นไปด้วยอัตโนมัติ
        const sql = `DELETE FROM exam_rounds WHERE academic_year = ?`;
        const [result] = await connection.query<any>(sql, [year]);

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
    } finally {
        connection.release();
    }
});