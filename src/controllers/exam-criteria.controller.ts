import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";

export const examCriteria = Router();

// ===================================================
// 1. ดึงเกณฑ์วิชาของรอบการสอบนั้นๆ (GET /:round_id)
// ===================================================
examCriteria.get("/:round_id", async (req: Request, res: Response): Promise<void> => {
    const round_id = req.params.round_id;
    const connection = await conn.getConnection();

    try {
        const sql = `
            SELECT 
                s.subject_code AS code,
                s.subject_name AS name,
                ec.full_score AS fullScore,
                ec.passing_score AS passScore
            FROM exam_criteria ec
            JOIN subjects s ON ec.subject_id = s.subject_id
            WHERE ec.round_id = ?
        `;
        const [rows] = await connection.query<any[]>(sql, [round_id]);

        res.status(200).json({ success: true, data: rows });

    } catch (error) {
        console.error("Error fetching criteria:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลเกณฑ์วิชา", error });
    } finally {
        connection.release();
    }
});

// ===================================================
// 2. บันทึกเกณฑ์วิชา (POST /:round_id) 
// ===================================================
examCriteria.post("/:round_id", async (req: Request, res: Response): Promise<void> => {
    const round_id = req.params.round_id;
    const { criteria } = req.body; 

    if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
        res.status(400).json({ success: false, message: "กรุณาส่งข้อมูลเกณฑ์วิชามาด้วย" });
        return;
    }

    const connection = await conn.getConnection();

    try {
        await connection.beginTransaction(); 

        // ✨ 1. จัดการตารางรายวิชา (แก้ 'active' เป็น 1 ให้ตรงกับ Database)
        const subjectValues = criteria.map(c => [c.code, c.name, 1]); // 🌟 เปลี่ยนตรงนี้
        const upsertSubjectsSql = `
            INSERT INTO subjects (subject_code, subject_name, status) 
            VALUES ?
            ON DUPLICATE KEY UPDATE 
            subject_name = VALUES(subject_name),
            status = 1 -- 🌟 เปลี่ยนตรงนี้ด้วย
        `;
        await connection.query(upsertSubjectsSql, [subjectValues]);

        // 🔍 2. ดึง subject_id จาก Database กลับมา (แปลงจาก subject_code)
        const subjectCodes = criteria.map(c => c.code);
        const [subjects] = await connection.query<any[]>(
            `SELECT subject_id, subject_code FROM subjects WHERE subject_code IN (?)`, 
            [subjectCodes]
        );
        const subjectMap = subjects.reduce((acc, row) => {
            acc[row.subject_code] = row.subject_id;
            return acc;
        }, {} as Record<string, number>);

        // 🗑️ 3. ลบเกณฑ์สอบ "ของเก่า" ในรอบนี้ทิ้งให้หมด 
        await connection.query(`DELETE FROM exam_criteria WHERE round_id = ?`, [round_id]);

        // 💾 4. บันทึกเกณฑ์สอบ "อันใหม่" ลงไป
        const criteriaValues = criteria.map(c => {
            const subject_id = subjectMap[c.code];
            return [c.fullScore, c.passScore, subject_id, round_id];
        }).filter(val => val[2] !== undefined); 

        if (criteriaValues.length > 0) {
            const insertCriteriaSql = `
                INSERT INTO exam_criteria (full_score, passing_score, subject_id, round_id) 
                VALUES ?
            `;
            await connection.query(insertCriteriaSql, [criteriaValues]);
        }

        await connection.commit(); 
        res.status(200).json({ success: true, message: "บันทึกเกณฑ์รายวิชาสำเร็จ!" });
        
    } catch (error) {
        await connection.rollback(); 
        console.error("Error saving criteria:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล", error });
    } finally {
        connection.release();
    }
});