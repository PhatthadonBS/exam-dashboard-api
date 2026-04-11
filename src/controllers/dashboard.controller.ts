import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";

export const dashboard = Router();

// =================================================================
// 🌟 1. /find-round
// =================================================================
dashboard.get('/find-round', async (req: Request, res: Response): Promise<any> => {
  const { year, type } = req.query;

  try {
    // 🌟 กรองเอาเฉพาะรอบที่เปิดใช้งาน (round_status = 1)
    let sql = `SELECT round_id FROM exam_rounds WHERE round_status = 1`;
    let params: any[] = [];

    if (year && year !== 'all') {
      sql += ` AND academic_year = ?`;
      params.push(year);
    }
    if (type && type !== 'all') {
      sql += ` AND round_type = ?`;
      params.push(type);
    }

    const [rows]: any = await conn.query(sql, params);

    if (rows.length > 0) {
      const roundIds = rows.map((r: any) => r.round_id).join(',');
      return res.json({ roundId: roundIds }); 
    } else {
      return res.json({ roundId: null, message: "ไม่พบข้อมูลรอบการสอบนี้" });
    }
  } catch (error) {
    console.error("Find Round Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 API ดึงปีการศึกษาทั้งหมดที่มีในระบบ (เพื่อเอาไปทำ Dropdown)
// =================================================================
dashboard.get('/academic-years', async (req: Request, res: Response): Promise<any> => {
  try {
    // 🌟 ดึงเฉพาะปีการศึกษาที่มีรอบที่เปิดใช้งานอยู่
    const sql = `SELECT DISTINCT academic_year FROM exam_rounds WHERE round_status = 1 ORDER BY academic_year DESC`;
    const [rows]: any = await conn.query(sql);
    
    const years = rows.map((r: any) => r.academic_year);
    
    return res.json({ years });
  } catch (error) {
    console.error("Fetch Academic Years Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 2. /students/:round_id  (หน้ารายบุคคล)
// =================================================================
dashboard.get('/students/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;
  try {
    // 🌟 ใช้คะแนน MAX เพื่อให้คนที่สอบผ่านในรอบซ่อม (4, 5) ถือว่าผ่าน
    const sqlStudents = `
      SELECT 
        st.std_code AS id, 
        SUM(bs.max_score) AS total, 
        SUM(bs.full_score) AS max,
        ROUND((SUM(bs.max_score) / SUM(bs.full_score)) * 100, 2) AS percent,
        CASE WHEN SUM(CASE WHEN bs.max_score < bs.passing_score THEN 1 ELSE 0 END) > 0 THEN 'fail' ELSE 'pass' END AS status,
        IFNULL(GROUP_CONCAT(CASE WHEN bs.max_score < bs.passing_score THEN s.subject_code ELSE NULL END ORDER BY s.subject_code ASC SEPARATOR ', '), '-') AS failedSub,
        GROUP_CONCAT(bs.max_score ORDER BY s.subject_code ASC SEPARATOR ',') AS scoresStr
      FROM students st
      JOIN (
          SELECT 
              es.std_id, es.subject_id, 
              MAX(es.score) AS max_score, 
              MAX(c.full_score) AS full_score, 
              MAX(c.passing_score) AS passing_score
          FROM exam_scores es
          JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
          JOIN exam_rounds r ON es.round_id = r.round_id
          -- 🌟 กรองเฉพาะรอบที่เปิดใช้งาน
          WHERE r.round_status = 1 AND FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs ON st.std_id = bs.std_id
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY st.std_id, st.std_code
    `;
    const [studentsRaw]: any = await conn.query(sqlStudents, [roundId]);
    const studentsList = studentsRaw.map((std: any) => ({
      ...std, percent: Number(std.percent), total: Number(std.total), max: Number(std.max),
      scoresArray: std.scoresStr ? std.scoresStr.split(',').map(Number) : []
    }));

    const sqlSubjects = `
      SELECT 
        s.subject_code AS code, s.subject_name AS name,
        ROUND(AVG(bs.max_score), 2) AS avg_score, MAX(bs.passing_score) AS pass_criteria
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score, MAX(c.passing_score) AS passing_score
          FROM exam_scores es
          JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
          JOIN exam_rounds r ON es.round_id = r.round_id
          -- 🌟 กรองเฉพาะรอบที่เปิดใช้งาน
          WHERE r.round_status = 1 AND FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY s.subject_id
      ORDER BY s.subject_code ASC
    `;
    const [subjectsRaw]: any = await conn.query(sqlSubjects, [roundId]);

    return res.json({
      studentsList,
      radarBase: {
        labels: subjectsRaw.map((s: any) => `${s.code} ${s.name}`),
        groupAvg: subjectsRaw.map((s: any) => Number(s.avg_score)),
        criteria: subjectsRaw.map((s: any) => Number(s.pass_criteria))
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 3. /subjects/:round_id (หน้าข้อมูลรายวิชา)
// =================================================================
dashboard.get('/subjects/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;
  try {
    const sql = `
      SELECT 
        s.subject_code AS code, s.subject_name AS name,
        MAX(bs.full_score) AS fullScore, MAX(bs.passing_score) AS passScore,
        ROUND(AVG(bs.max_score), 2) AS avg, ROUND(STDDEV(bs.max_score), 2) AS sd,
        MIN(bs.max_score) AS min, MAX(bs.max_score) AS max,
        SUM(CASE WHEN bs.max_score >= bs.passing_score THEN 1 ELSE 0 END) AS passCount,
        COUNT(bs.max_score) AS totalCount,
        GROUP_CONCAT(bs.max_score ORDER BY bs.max_score ASC SEPARATOR ',') AS all_scores
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score, MAX(c.full_score) AS full_score, MAX(c.passing_score) AS passing_score
          FROM exam_scores es
          JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
          JOIN exam_rounds r ON es.round_id = r.round_id
          -- 🌟 กรองเฉพาะรอบที่เปิดใช้งาน
          WHERE r.round_status = 1 AND FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY s.subject_id
      ORDER BY s.subject_code ASC
    `;
    const [rawStats]: any = await conn.query(sql, [roundId]);

    const subjectStats = rawStats.map((row: any) => {
      const passRate = row.totalCount > 0 ? Math.round((row.passCount / row.totalCount) * 100) : 0;
      let median = 0;
      if (row.all_scores) {
        const scores = row.all_scores.split(',').map(Number).sort((a: number, b: number) => a - b);
        const mid = Math.floor(scores.length / 2);
        median = scores.length % 2 !== 0 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
      }
      return {
        code: row.code, name: row.name, fullScore: Number(row.fullScore), passScore: Number(row.passScore),
        avg: Number(row.avg) || 0, sd: Number(row.sd) || 0, min: Number(row.min) || 0, max: Number(row.max) || 0,
        passRate: passRate, median: Number(median.toFixed(1))
      }; 
    });

    return res.json({ subjectStats });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 4. /:round_id (หน้าภาพรวม Overview)
// =================================================================
dashboard.get('/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;
  try {
    const sqlSubjects = `
      SELECT 
        s.subject_code AS code, s.subject_name AS name,
        MAX(bs.full_score) AS full, MAX(bs.passing_score) AS passCriteria,
        ROUND(AVG(bs.max_score), 2) AS avg, ROUND((AVG(bs.max_score) / MAX(bs.full_score)) * 100, 2) AS percent,
        SUM(CASE WHEN bs.max_score >= bs.passing_score THEN 1 ELSE 0 END) AS pass,
        SUM(CASE WHEN bs.max_score < bs.passing_score THEN 1 ELSE 0 END) AS fail
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score, MAX(c.full_score) AS full_score, MAX(c.passing_score) AS passing_score
          FROM exam_scores es
          JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
          JOIN exam_rounds r ON es.round_id = r.round_id
          -- 🌟 กรองเฉพาะรอบที่เปิดใช้งาน
          WHERE r.round_status = 1 AND FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY s.subject_id
    `;
    const [subjectsList]: any = await conn.query(sqlSubjects, [roundId]);

    const sqlStudents = `
      SELECT 
        bs.std_id,
        SUM(CASE WHEN bs.max_score < bs.passing_score THEN 1 ELSE 0 END) AS failed_subjects_count,
        AVG((bs.max_score / bs.full_score) * 100) AS student_avg_percent
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score, MAX(c.full_score) AS full_score, MAX(c.passing_score) AS passing_score
          FROM exam_scores es
          JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
          JOIN exam_rounds r ON es.round_id = r.round_id
          -- 🌟 กรองเฉพาะรอบที่เปิดใช้งาน
          WHERE r.round_status = 1 AND FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs
      GROUP BY bs.std_id
    `;
    const [studentsData]: any = await conn.query(sqlStudents, [roundId]);

    // คำนวณ Summary และ Histogram 
    let passedAll = 0, failedSome = 0, totalPercent = 0, maxScore = 0, minScore = 100;
    const distribution = Array(10).fill(0);

    studentsData.forEach((std: any) => {
      if (Number(std.failed_subjects_count) === 0) passedAll++; else failedSome++;
      const avgPercent = Number(std.student_avg_percent) || 0;
      totalPercent += avgPercent;
      
      if (avgPercent > maxScore) maxScore = avgPercent;
      if (avgPercent < minScore) minScore = avgPercent;

      let bucketIndex = Math.floor(avgPercent / 10);
      if (bucketIndex >= 10) bucketIndex = 9; 
      if (bucketIndex < 0) bucketIndex = 0;
      distribution[bucketIndex]++; 
    });

    if (studentsData.length === 0) minScore = 0;
    const totalStudents = studentsData.length;
    const avgScore = totalStudents > 0 ? (totalPercent / totalStudents) : 0;

    const summary = {
      totalStudents, passedAll, failedSome,
      avgScore: Number(avgScore.toFixed(1)), maxScore: Number(maxScore.toFixed(1)), minScore: Number(minScore.toFixed(1))  
    };

    const radarLabels = subjectsList.map((s: any) => `${s.code} ${s.name}`);
    const radarAvgData = subjectsList.map((s: any) => s.percent);
    const radarCriteriaData = subjectsList.map((s: any) => Number(((s.passCriteria / s.full) * 100).toFixed(1)));

    const sortedByPercent = [...subjectsList].sort((a, b) => a.percent - b.percent);
    const weakest = sortedByPercent.slice(0, 2); 
    const strongest = sortedByPercent.slice(-2).reverse();

    const aiInsights = {
      weaknesses: weakest.length > 0 ? `วิชา ${weakest.map(w => w.name).join(' และ ')} น่ากังวลที่สุด (เฉลี่ย ${weakest.map(w => w.percent+'%').join(', ')})` : 'ยังไม่มีข้อมูลเพียงพอ',
      strengths: strongest.length > 0 ? `วิชา ${strongest.map(s => s.name).join(' และ ')} ทำผลงานได้ดีที่สุด` : 'ยังไม่มีข้อมูลเพียงพอ',
      recommendation: weakest.length > 0 ? `ควรจัดคอร์สติวเข้มด่วนในวิชา "${weakest[0]?.name}" ก่อนเป็นอันดับแรก` : 'ภาพรวมอยู่ในเกณฑ์ปกติ'
    };

    return res.json({
      summary, subjectsList, aiInsights, distributionData: distribution,
      radarData: { labels: radarLabels, avgData: radarAvgData, criteriaData: radarCriteriaData }
    });

  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 API เช็คว่ารอบการสอบนี้มีข้อมูลผลคะแนนหรือไม่ (length > 0)
// =================================================================
dashboard.get('/check-results/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;

  try {
    // ใช้ LIMIT 1 เพื่อลดภาระ Database ถ้าเจอแค่ 1 record ก็แปลว่ามีข้อมูลแล้ว
    const sql = `
      SELECT * 
      FROM exam_scores 
      WHERE FIND_IN_SET(round_id, ?) > 0 
      LIMIT 1
    `;
    const [rows]: any = await conn.query(sql, [roundId]);

    // ถ้า rows.length > 0 แปลว่ามีข้อมูลอย่างน้อย 1 แถว
    const hasData = rows.length > 0;

    return res.json({ hasData });

  } catch (error) {
    console.error("Check Results Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});