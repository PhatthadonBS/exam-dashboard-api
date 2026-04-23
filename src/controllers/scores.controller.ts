import { Router, Request, Response } from 'express';
import { conn } from '../config/connect_db.js';

export const scores = Router();

// ========================================================
// 1. API นำเข้าคะแนน (POST /scores/import)
// ========================================================
scores.post('/import', async (req: Request, res: Response): Promise<void> => {
    const { round_id, scores_data } = req.body;

    if (!round_id || !scores_data || scores_data.length === 0) {
        res.status(400).json({ success: false, message: "ข้อมูลไม่ครบถ้วน กรุณาระบุรอบการสอบและคะแนน" });
        return;
    }

    const connection = await conn.getConnection();

    try {
        await connection.beginTransaction();

        const [roundInfo] = await connection.query<any[]>('SELECT round_type FROM exam_rounds WHERE round_id = ?', [round_id]);
        const roundType = roundInfo[0]?.round_type;
        // 🌟 FIX: แปลงเป็น Number ก่อนเช็ค ป้องกัน String '2' จาก Database
        const isLicense = Number(roundType) === 2; 

        const [subjects] = await connection.query<any[]>('SELECT subject_id, subject_code FROM subjects');
        const subjectMap = subjects.reduce((acc, row) => {
            acc[row.subject_code] = row.subject_id;
            return acc;
        }, {} as Record<string, number>);

        const [students] = await connection.query<any[]>('SELECT std_id, std_code FROM students');
        const studentMap = students.reduce((acc, row) => {
            acc[row.std_code] = row.std_id;
            return acc;
        }, {} as Record<string, number>);

        const valuesToInsert: any[][] = [];

        for (const student of scores_data) {
            let std_id = studentMap[student.std_code];

            if (!std_id) {
                const [insertStd] = await connection.query<any>(
                    `INSERT INTO students (std_code, status) VALUES (?, 1)`, [student.std_code]
                );
                std_id = insertStd.insertId;
                studentMap[student.std_code] = std_id; 
            }

            if (isLicense) {
                const paper_result = student.license_result; 
                if (paper_result !== null && paper_result !== undefined) {
                    valuesToInsert.push([std_id, round_id, paper_result]);
                }
            } else {
                for (const sub of student.subjects) {
                    const subject_id = subjectMap[sub.subject_code];
                    if (subject_id && sub.score !== null && sub.score !== undefined) {
                        valuesToInsert.push([sub.score, std_id, subject_id, round_id]);
                    }
                }
            }
        }

        if (valuesToInsert.length === 0) {
             res.status(400).json({ success: false, message: "ไม่พบข้อมูลคะแนนหรือรายวิชาในระบบ" });
             return;
        }

        if (isLicense) {
            const sql = `
                INSERT INTO exam_paper_result (std_id, round_id, paper_result) 
                VALUES ?
                ON DUPLICATE KEY UPDATE 
                paper_result = VALUES(paper_result)
            `;
            await connection.query(sql, [valuesToInsert]);
        } else {
            const sql = `
                INSERT INTO exam_scores (score, std_id, subject_id, round_id) 
                VALUES ?
                ON DUPLICATE KEY UPDATE 
                score = VALUES(score)
            `;
            await connection.query(sql, [valuesToInsert]);
        }

        await connection.commit();
        res.status(200).json({ success: true, message: "บันทึกคะแนนสำเร็จ", records_processed: valuesToInsert.length });

    } catch (error) {
        await connection.rollback();
        console.error("Error importing scores:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกคะแนนเซิร์ฟเวอร์", error });
    } finally {
        connection.release();
    }
});

// ========================================================
// 2. API ดึงคะแนนรายรอบสอบ (GET /scores/:round_id)
// ========================================================
scores.get('/:round_id', async (req: Request, res: Response): Promise<void> => {
    const round_id = req.params.round_id;
    const connection = await conn.getConnection();

    try {
        const [roundInfo] = await connection.query<any[]>('SELECT round_type FROM exam_rounds WHERE round_id = ?', [round_id]);
        const roundType = roundInfo[0]?.round_type;

        // 🌟 FIX: แปลงเป็น Number ก่อนเช็ค
        if (Number(roundType) === 2) {
            const sql = `
                SELECT st.std_code, epr.paper_result
                FROM exam_paper_result epr
                JOIN students st ON epr.std_id = st.std_id
                WHERE epr.round_id = ?
            `;
            const [rows] = await connection.query<any[]>(sql, [round_id]);

            const result = rows.map(r => ({
                std_code: r.std_code,
                paper_result: r.paper_result 
            }));
            
            res.status(200).json({ success: true, data: result });

        } else {
            const sql = `
                SELECT st.std_code, su.subject_code, es.score
                FROM exam_scores es
                JOIN students st ON es.std_id = st.std_id
                JOIN subjects su ON es.subject_id = su.subject_id
                WHERE es.round_id = ?
            `;
            const [rows] = await connection.query<any[]>(sql, [round_id]);
            const studentScoresMap: Record<string, any> = {};

            for (const row of rows) {
                if (!studentScoresMap[row.std_code]) {
                    studentScoresMap[row.std_code] = { std_code: row.std_code, scores: {} };
                }
                studentScoresMap[row.std_code].scores[row.subject_code] = row.score;
            }

            res.status(200).json({ success: true, data: Object.values(studentScoresMap) });
        }

    } catch (error) {
        console.error("Error fetching scores:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลคะแนน", error });
    } finally {
        connection.release();
    }
});

// ========================================================
// 3. API ดึงสรุปผลแบบ Matrix (GET /scores/summary/:year)
// ========================================================
scores.get('/summary/:year', async (req: Request, res: Response): Promise<void> => {
    const year = req.params.year;
    const connection = await conn.getConnection();

    try {
        // 🌟 FIX: เพิ่ม AND round_status = 1 เพื่อให้ข้อมูลตรงกับ Dashboard
        const [rounds] = await connection.query<any[]>(
            `SELECT round_id, round_type, round_number 
             FROM exam_rounds 
             WHERE academic_year = ? AND round_status = 1 
             ORDER BY round_type ASC, round_number ASC`, [year]
        );

        if (rounds.length === 0) {
             res.status(200).json({ success: true, rounds: [], data: [] });
             return;
        }

        // 🌟 FIX: แปลง r.round_type เป็น Number ก่อนเช็ค
        const preRoundIds = rounds.filter(r => Number(r.round_type) === 1).map(r => r.round_id);
        const licRoundIds = rounds.filter(r => Number(r.round_type) === 2).map(r => r.round_id);

        const studentMap: any = {};
        const initStudent = (std_code: string) => {
            if (!studentMap[std_code]) {
                studentMap[std_code] = { id: std_code, year: Number(year), rounds: {} };
            }
        };

        // 📝 1. ประมวลผลความรู้ (Type 1)
        if (preRoundIds.length > 0) {
            const [criteria] = await connection.query<any[]>(
                `SELECT round_id, subject_id, passing_score FROM exam_criteria WHERE round_id IN (?)`, [preRoundIds]
            );
            const criteriaMap: any = {};
            criteria.forEach(c => {
                if (!criteriaMap[c.round_id]) criteriaMap[c.round_id] = {};
                criteriaMap[c.round_id][c.subject_id] = Number(c.passing_score);
            });

            const [scoresData] = await connection.query<any[]>(`
                SELECT s.std_code, es.round_id, es.subject_id, es.score
                FROM exam_scores es
                JOIN students s ON es.std_id = s.std_id
                WHERE es.round_id IN (?)
            `, [preRoundIds]);

            const preScoresMap: any = {};
            scoresData.forEach(row => {
                initStudent(row.std_code);
                if (!preScoresMap[row.std_code]) preScoresMap[row.std_code] = {};
                if (!preScoresMap[row.std_code][row.round_id]) preScoresMap[row.std_code][row.round_id] = {};
                preScoresMap[row.std_code][row.round_id][row.subject_id] = Number(row.score);
            });

            Object.keys(preScoresMap).forEach(std_code => {
                preRoundIds.forEach(r_id => {
                    const roundData = preScoresMap[std_code][r_id];
                    
                    if (roundData) {
                        let failCount = 0;
                        let subjectCount = 0;
                        const roundCriteria = criteriaMap[r_id] || {};
                        
                        Object.keys(roundCriteria).forEach(subId => {
                            subjectCount++;
                            const passScore = roundCriteria[subId];
                            const actualScore = roundData[subId] || 0;
                            if (actualScore < passScore) failCount++;
                        });

                        if (failCount === 0 && subjectCount > 0) {
                            studentMap[std_code].rounds[r_id] = { status: 'pass', detail: `ผ่านครบ ${subjectCount} วิชา` };
                        } else {
                            studentMap[std_code].rounds[r_id] = { status: 'fail', detail: `ตก ${failCount} วิชา` };
                        }
                    }
                });
            });
        }

        // 🎓 2. ใบประกอบวิชาชีพ (Type 2)
        if (licRoundIds.length > 0) {
            const [licData] = await connection.query<any[]>(`
                SELECT s.std_code, epr.round_id, epr.paper_result
                FROM exam_paper_result epr
                JOIN students s ON epr.std_id = s.std_id
                WHERE epr.round_id IN (?)
            `, [licRoundIds]);

            licData.forEach(row => {
                initStudent(row.std_code);
                
                let status = 'none';
                let detail = '';
                
                // 🌟 FIX: แปลง paper_result เป็น Number ก่อนเช็ค
                const pr = Number(row.paper_result);
                
                if (pr === 3) {
                    status = 'pass';
                    detail = 'ผ่าน';
                } else if (pr === 2) {
                    status = 'fail';
                    detail = 'ไม่ผ่าน';
                } else if (pr === 1) {
                    status = 'pending';
                    detail = 'รอดำเนินการ';
                }
                
                studentMap[row.std_code].rounds[row.round_id] = { status, detail };
            });
        }

        res.status(200).json({ success: true, rounds: rounds, data: Object.values(studentMap) });

    } catch (error) {
        console.error("Error fetching matrix summary:", error);
        res.status(500).json({ success: false, message: "Server Error", error });
    } finally {
        connection.release();
    }
});