import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js"; 

export const subjects = Router();

// ดึงข้อมูลรายวิชาทั้งหมด พร้อมดึง "คะแนนเกณฑ์ล่าสุด" ที่เคยตั้งไว้มาด้วย
subjects.get("/", async (req: Request, res: Response) => {
    const connection = await conn.getConnection();
    try {
        // 🌟 ใช้ Subquery ไปดึงคะแนนเต็ม (full_score) และคะแนนผ่าน (passing_score) ล่าสุดจาก exam_criteria
        const sql = `
            SELECT 
                s.subject_code, 
                s.subject_name,
                COALESCE((SELECT full_score FROM exam_criteria ec WHERE ec.subject_id = s.subject_id ORDER BY criteria_id DESC LIMIT 1), 0) AS full_score,
                COALESCE((SELECT passing_score FROM exam_criteria ec WHERE ec.subject_id = s.subject_id ORDER BY criteria_id DESC LIMIT 1), 0) AS passing_score
            FROM subjects s 
            WHERE s.status = 1 
            ORDER BY s.subject_code ASC
        `;
        
        const [rows] = await connection.query(sql);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลวิชา" });
    } finally {
        connection.release();
    }
});