import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";

export const dashboard = Router();

// =================================================================
// 🌟 อัปเดต /find-round ให้รองรับ round_number (ครั้งที่)
// =================================================================
dashboard.get(
  "/find-round",
  async (req: Request, res: Response): Promise<any> => {
    const { year, type, round_number } = req.query; // เพิ่ม round_number

    try {
      let sql = `SELECT round_id FROM exam_rounds WHERE round_status = 1`;
      let params: any[] = [];

      if (year && year !== "all") {
        sql += ` AND academic_year = ?`;
        params.push(year);
      }
      if (type && type !== "all") {
        sql += ` AND round_type = ?`;
        params.push(type);
      }
      if (round_number && round_number !== "all") {
        sql += ` AND round_number = ?`;
        params.push(round_number);
      }

      const [rows]: any = await conn.query(sql, params);
      if (rows.length > 0) {
        const roundIds = rows.map((r: any) => r.round_id).join(",");
        return res.json({ roundId: roundIds });
      } else {
        return res.json({ roundId: null, message: "ไม่พบข้อมูลรอบการสอบนี้" });
      }
    } catch (error) {
      console.error("Find Round Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

// =================================================================
// 🌟 API ดึง "ครั้งที่สอบ" ตามปีและประเภทการสอบ
// =================================================================
dashboard.get(
  "/available-rounds",
  async (req: Request, res: Response): Promise<any> => {
    const { year, type } = req.query;
    try {
      const sql = `
      SELECT DISTINCT round_number 
      FROM exam_rounds 
      WHERE round_status = 1 AND academic_year = ? AND round_type = ? 
      ORDER BY round_number ASC
    `;
      const [rows]: any = await conn.query(sql, [year, type]);
      const rounds = rows.map((r: any) => r.round_number);
      return res.json({ rounds });
    } catch (error) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

// =================================================================
// 🌟 API ดึงข้อมูลสรุป "ใบประกอบวิชาชีพ" (แยกตามปี)
// =================================================================
// =================================================================
// 🌟 API ดึงข้อมูลสรุป "ใบประกอบวิชาชีพ" (แยกตามปี + ยอดรวมคนจริงๆ)
// =================================================================
dashboard.get("/license-summary", async (req: Request, res: Response): Promise<any> => {
  const { start, end } = req.query;

  try {
    let whereClause = ``;
    let params: any[] = [];

    if (start && end) {
      whereClause = ` AND r.academic_year BETWEEN ? AND ?`;
      params.push(start, end);
    }

    // 1. ดึงข้อมูลรายปี (นับคนไม่ซ้ำในแต่ละปี โดยยึดผลสอบที่ดีที่สุด)
    const sqlYearly = `
      SELECT 
          year_data.academic_year,
          SUM(CASE WHEN year_data.best_result = 3 THEN 1 ELSE 0 END) AS pass_count,
          SUM(CASE WHEN year_data.best_result = 2 THEN 1 ELSE 0 END) AS fail_count
      FROM (
          SELECT r.academic_year, epr.std_id, MAX(epr.paper_result) AS best_result
          FROM exam_paper_result epr
          JOIN exam_rounds r ON epr.round_id = r.round_id
          WHERE r.round_status = 1 AND r.round_type = 2 ${whereClause} 
          GROUP BY r.academic_year, epr.std_id
      ) year_data
      GROUP BY year_data.academic_year
      ORDER BY year_data.academic_year ASC
    `;
    const [yearlyRows]: any = await conn.query(sqlYearly, params);

    // 2. ดึงข้อมูลสรุปรวมทั้งหมด (นับคนไม่ซ้ำเลยตลอดช่วงปีที่เลือก)
    const sqlOverall = `
      SELECT 
          SUM(CASE WHEN overall_data.best_result = 3 THEN 1 ELSE 0 END) AS pass_count,
          SUM(CASE WHEN overall_data.best_result = 2 THEN 1 ELSE 0 END) AS fail_count
      FROM (
          SELECT epr.std_id, MAX(epr.paper_result) AS best_result
          FROM exam_paper_result epr
          JOIN exam_rounds r ON epr.round_id = r.round_id
          WHERE r.round_status = 1 AND r.round_type = 2 ${whereClause} 
          GROUP BY epr.std_id
      ) overall_data
    `;
    // 🌟 ส่ง params ไปอีกรอบสำหรับ Query ตัวที่ 2
    const [overallRows]: any = await conn.query(sqlOverall, params);

    return res.json({ 
      licenseData: yearlyRows, 
      overallSummary: overallRows[0] 
    });
  } catch (error) {
    console.error("License Summary Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 API ดึงปีการศึกษาทั้งหมดที่มีในระบบ (เพื่อเอาไปทำ Dropdown)
// =================================================================
dashboard.get(
  "/academic-years",
  async (req: Request, res: Response): Promise<any> => {
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
  },
);

// =================================================================
// 🌟 2. /students/:round_id (หน้ารายบุคคล - Full Version)
// =================================================================
dashboard.get(
  "/students/:round_id",
  async (req: Request, res: Response): Promise<any> => {
    const roundId = req.params.round_id;
    try {
      // 1. ตรวจสอบประเภทของรอบการสอบ (เช็คจาก ID แรกในชุดข้อมูล)
      const [roundCheck]: any = await conn.query(
        "SELECT round_type FROM exam_rounds WHERE FIND_IN_SET(round_id, ?) > 0 LIMIT 1",
        [roundId],
      );

      if (roundCheck.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "ไม่พบข้อมูลรอบการสอบ" });
      }

      const roundType = roundCheck[0].round_type;

      // --- 🌟 กรณีสอบใบประกอบวิชาชีพ (Type 2): ดึงจาก exam_paper_result เท่านั้น ---
      if (roundType === 2) {
        const sqlLicenseStudents = `
        SELECT 
          st.std_code AS id, 
          epr.paper_result,
          CASE 
            WHEN epr.paper_result = 3 THEN 'pass' 
            WHEN epr.paper_result = 2 THEN 'fail' 
            ELSE 'pending' 
          END AS status,
          '-' AS failedSub, 
          0 AS total, 
          0 AS max, 
          0 AS percent,
          '' AS scoresStr
        FROM students st
        JOIN exam_paper_result epr ON st.std_id = epr.std_id
        WHERE FIND_IN_SET(epr.round_id, ?) > 0
        ORDER BY st.std_code ASC
      `;

        const [rows]: any = await conn.query(sqlLicenseStudents, [roundId]);

        const studentsList = rows.map((std: any) => ({
          ...std,
          percent: 0,
          total: 0,
          max: 0,
          scoresArray: [],
        }));

        return res.json({
          success: true,
          studentsList,
          radarBase: { labels: [], groupAvg: [], criteria: [] }, // Type 2 ไม่แสดง Radar Chart รายวิชา
        });
      }

      // --- 🌟 กรณีสอบประมวลความรู้ (Type 1): ดึงจาก exam_scores ---

      // 2. Query ข้อมูลนิสิตและคะแนนดิบ
      const sqlStudents = `
      SELECT 
        st.std_code AS id, 
        SUM(bs.max_score) AS total, 
        SUM(bs.full_score) AS max,
        ROUND((SUM(bs.max_score) / SUM(bs.full_score)) * 100, 2) AS percent,
        CASE 
          WHEN SUM(CASE WHEN bs.max_score < bs.passing_score THEN 1 ELSE 0 END) > 0 THEN 'fail' 
          ELSE 'pass' 
        END AS status,
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
          WHERE FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs ON st.std_id = bs.std_id
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY st.std_id, st.std_code
      ORDER BY st.std_code ASC
    `;
      const [studentsRaw]: any = await conn.query(sqlStudents, [roundId]);

      const studentsList = studentsRaw.map((std: any) => ({
        ...std,
        percent: Number(std.percent),
        total: Number(std.total),
        max: Number(std.max),
        scoresArray: std.scoresStr ? std.scoresStr.split(",").map(Number) : [],
      }));

      // 3. Query ข้อมูลค่าเฉลี่ยรายกลุ่ม (สำหรับ Radar Chart พื้นหลัง)
      const sqlSubjects = `
      SELECT 
        s.subject_code AS code, s.subject_name AS name,
        ROUND(AVG(bs.max_score), 2) AS avg_score, 
        MAX(bs.passing_score) AS pass_criteria
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score, MAX(c.passing_score) AS passing_score
          FROM exam_scores es
          JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
          WHERE FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY s.subject_id
      ORDER BY s.subject_code ASC
    `;
      const [subjectsRaw]: any = await conn.query(sqlSubjects, [roundId]);

      return res.json({
        success: true,
        studentsList,
        radarBase: {
          labels: subjectsRaw.map((s: any) => `${s.code} ${s.name}`),
          groupAvg: subjectsRaw.map((s: any) => Number(s.avg_score)),
          criteria: subjectsRaw.map((s: any) => Number(s.pass_criteria)),
        },
      });
    } catch (error) {
      console.error("Fetch Individual Students Error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  },
);

// =================================================================
// 🌟 3. /subjects/:round_id (หน้าข้อมูลรายวิชา)
// =================================================================
dashboard.get(
  "/subjects/:round_id",
  async (req: Request, res: Response): Promise<any> => {
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
          WHERE r.round_status = 1 AND FIND_IN_SET(es.round_id, ?) > 0
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN subjects s ON bs.subject_id = s.subject_id
      GROUP BY s.subject_id
      ORDER BY s.subject_code ASC
    `;
      const [rawStats]: any = await conn.query(sql, [roundId]);

      const subjectStats = rawStats.map((row: any) => {
        const passRate =
          row.totalCount > 0
            ? Math.round((row.passCount / row.totalCount) * 100)
            : 0;
        let median = 0;
        if (row.all_scores) {
          const scores = row.all_scores
            .split(",")
            .map(Number)
            .sort((a: number, b: number) => a - b);
          const mid = Math.floor(scores.length / 2);
          median =
            scores.length % 2 !== 0
              ? scores[mid]
              : (scores[mid - 1] + scores[mid]) / 2;
        }
        return {
          code: row.code,
          name: row.name,
          fullScore: Number(row.fullScore),
          passScore: Number(row.passScore),
          avg: Number(row.avg) || 0,
          sd: Number(row.sd) || 0,
          min: Number(row.min) || 0,
          max: Number(row.max) || 0,
          passRate: passRate,
          median: Number(median.toFixed(1)),
        };
      });

      return res.json({ subjectStats });
    } catch (error) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

// =================================================================
// 🌟 4. /:round_id (หน้าภาพรวม Overview)
// =================================================================
// =================================================================
// 🌟 4. /:round_id (หน้าภาพรวม Overview - Full Version)
// =================================================================
dashboard.get(
  "/:round_id",
  async (req: Request, res: Response): Promise<any> => {
    const roundId = req.params.round_id;
    try {
      // 1. ตรวจสอบประเภทของรอบการสอบ
      const [roundCheck]: any = await conn.query(
        "SELECT round_type FROM exam_rounds WHERE round_id = ?",
        [roundId],
      );

      if (roundCheck.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "ไม่พบรอบการสอบ" });
      }

      const roundType = roundCheck[0].round_type;

      // --- 🌟 กรณีสอบใบประกอบวิชาชีพ (Type 2): ดึงจาก exam_paper_result เท่านั้น ---
      if (roundType === 2) {
        const sqlLicense = `
        SELECT 
          COUNT(std_id) AS totalStudents,
          SUM(CASE WHEN paper_result = 3 THEN 1 ELSE 0 END) AS passedAll,
          SUM(CASE WHEN paper_result = 2 THEN 1 ELSE 0 END) AS failedSome
        FROM exam_paper_result 
        WHERE round_id = ?
      `;
        const [rows]: any = await conn.query(sqlLicense, [roundId]);

        return res.json({
          success: true,
          summary: {
            totalStudents: Number(rows[0].totalStudents) || 0,
            passedAll: Number(rows[0].passedAll) || 0,
            failedSome: Number(rows[0].failedSome) || 0,
            avgScore: 0,
            maxScore: 0,
            minScore: 0,
          },
          subjectsList: [], // Type 2 ไม่เน้นรายละเอียดรายวิชาในหน้า Overview
          distributionData: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          radarData: { labels: [], avgData: [], criteriaData: [] },
          aiInsights: {
            recommendation: "สรุปผลการสอบใบประกอบวิชาชีพรายบุคคลเรียบร้อยแล้ว",
          },
        });
      }

      // --- 🌟 กรณีสอบประมวลความรู้ (Type 1): คำนวณจาก exam_scores และ exam_criteria ---

      // 2. ดึงข้อมูลรายวิชา (สำหรับตารางและ Radar Chart)
      const sqlSubjects = `
      SELECT 
        s.subject_code AS code, s.subject_name AS name,
        MAX(c.full_score) AS full, MAX(c.passing_score) AS passCriteria,
        ROUND(AVG(bs.max_score), 2) AS avg, 
        ROUND((AVG(bs.max_score) / MAX(c.full_score)) * 100, 2) AS percent,
        SUM(CASE WHEN bs.max_score >= c.passing_score THEN 1 ELSE 0 END) AS pass,
        SUM(CASE WHEN bs.max_score < c.passing_score THEN 1 ELSE 0 END) AS fail
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score
          FROM exam_scores es
          WHERE es.round_id = ?
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN subjects s ON bs.subject_id = s.subject_id
      JOIN exam_criteria c ON bs.subject_id = c.subject_id AND c.round_id = ?
      GROUP BY s.subject_id
    `;
      const [subjectsList]: any = await conn.query(sqlSubjects, [
        roundId,
        roundId,
      ]);

      // 3. ดึงข้อมูลนิสิตรายคน (สำหรับ Summary และ Histogram)
      const sqlStudents = `
      SELECT 
        bs.std_id,
        SUM(CASE WHEN bs.max_score < c.passing_score THEN 1 ELSE 0 END) AS failed_subjects_count,
        AVG((bs.max_score / c.full_score) * 100) AS student_avg_percent
      FROM (
          SELECT es.std_id, es.subject_id, MAX(es.score) AS max_score
          FROM exam_scores es
          WHERE es.round_id = ?
          GROUP BY es.std_id, es.subject_id
      ) bs
      JOIN exam_criteria c ON bs.subject_id = c.subject_id AND c.round_id = ?
      GROUP BY bs.std_id
    `;
      const [studentsData]: any = await conn.query(sqlStudents, [
        roundId,
        roundId,
      ]);

      // 4. ประมวลผล Logic สถิติ
      let passedAll = 0,
        failedSome = 0,
        totalPercent = 0;
      let maxScore = 0,
        minScore = 100;
      const distribution = Array(10).fill(0);

      studentsData.forEach((std: any) => {
        const failedCount = Number(std.failed_subjects_count);
        const avgPercent = Number(std.student_avg_percent) || 0;

        if (failedCount === 0) passedAll++;
        else failedSome++;

        totalPercent += avgPercent;
        if (avgPercent > maxScore) maxScore = avgPercent;
        if (avgPercent < minScore) minScore = avgPercent;

        // จัดลงถัง Histogram (0-10, 10-20, ..., 90-100)
        let bucketIndex = Math.floor(avgPercent / 10);
        if (bucketIndex >= 10) bucketIndex = 9;
        if (bucketIndex < 0) bucketIndex = 0;
        distribution[bucketIndex]++;
      });

      const totalStudents = studentsData.length;
      if (totalStudents === 0) minScore = 0;
      const avgScoreOverall =
        totalStudents > 0 ? totalPercent / totalStudents : 0;

      // 5. เตรียมข้อมูล Radar Chart
      const radarLabels = subjectsList.map((s: any) => `${s.code} ${s.name}`);
      const radarAvgData = subjectsList.map((s: any) => s.percent);
      const radarCriteriaData = subjectsList.map((s: any) =>
        Number(((s.passCriteria / s.full) * 100).toFixed(1)),
      );

      // 6. สร้าง AI Insights เบื้องต้น
      const sortedByPercent = [...subjectsList].sort(
        (a, b) => a.percent - b.percent,
      );
      const weakest = sortedByPercent.slice(0, 2);
      const strongest = sortedByPercent.slice(-2).reverse();

      const aiInsights = {
        weaknesses:
          weakest.length > 0
            ? `วิชา ${weakest.map((w) => w.name).join(" และ ")} มีคะแนนเฉลี่ยต่ำสุด`
            : "ยังไม่มีข้อมูล",
        strengths:
          strongest.length > 0
            ? `นิสิตส่วนใหญ่ทำผลงานได้ดีในวิชา ${strongest.map((s) => s.name).join(" และ ")}`
            : "ยังไม่มีข้อมูล",
        recommendation:
          weakest.length > 0
            ? `ควรให้ความสำคัญกับวิชา ${weakest[0].name} ในการติวรอบถัดไป`
            : "รักษามาตรฐานการเรียนการสอนในระดับเดิม",
      };

      return res.json({
        success: true,
        summary: {
          totalStudents,
          passedAll,
          failedSome,
          avgScore: Number(avgScoreOverall.toFixed(1)),
          maxScore: Number(maxScore.toFixed(1)),
          minScore: Number(minScore.toFixed(1)),
        },
        subjectsList,
        distributionData: distribution,
        radarData: {
          labels: radarLabels,
          avgData: radarAvgData,
          criteriaData: radarCriteriaData,
        },
        aiInsights,
      });
    } catch (error) {
      console.error("Overview Error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  },
);

// =================================================================
// 🌟 API เช็คว่ารอบการสอบนี้มีข้อมูลผลคะแนนหรือไม่ (length > 0)
// =================================================================
dashboard.get(
  "/check-results/:round_id",
  async (req: Request, res: Response): Promise<any> => {
    const roundId = req.params.round_id;
    try {
      const [round]: any = await conn.query(
        "SELECT round_type FROM exam_rounds WHERE round_id = ?",
        [roundId],
      );
      if (round.length === 0) return res.json({ hasResults: 0 });

      // แยกตารางเช็คตามประเภท
      const table =
        round[0].round_type === 2 ? "exam_paper_result" : "exam_scores";
      const [rows]: any = await conn.query(
        `SELECT std_id FROM ${table} WHERE round_id = ? LIMIT 1`,
        [roundId],
      );

      return res.json({ hasResults: rows.length });
    } catch (error) {
      console.error("Check Results Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

// =================================================================
// 🌟 5. /student-history/:std_code (ดึงประวัติคะแนนแยกรายวิชาของเด็ก 1 คน)
// =================================================================
// =================================================================
// 🌟 5. /student-history/:std_code (ดึงประวัติคะแนนแยกรายวิชา + ใบประกอบฯ ของเด็ก 1 คน)
// =================================================================
dashboard.get(
  "/student-history/:std_code",
  async (req: Request, res: Response): Promise<any> => {
    const stdCode = req.params.std_code;

    try {
      // 🌟 ใช้ UNION ALL เพื่อนำข้อมูลจาก 2 ตาราง (Type 1 และ Type 2) มาต่อกัน
      // ต้องสร้างคอลัมน์หลอก (NULL) ให้ทั้ง 2 ก้อนมีโครงสร้างตรงกัน
      const sql = `
        SELECT 
          s.subject_code,
          s.subject_name,
          r.academic_year,
          r.round_number,
          r.round_type,
          es.score,
          c.full_score,
          c.passing_score,
          NULL AS paper_result
        FROM exam_scores es
        JOIN subjects s ON es.subject_id = s.subject_id
        JOIN exam_rounds r ON es.round_id = r.round_id
        JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
        JOIN students st ON es.std_id = st.std_id
        WHERE st.std_code = ? AND r.round_status = 1
        
        UNION ALL
        
        SELECT 
          NULL AS subject_code,
          NULL AS subject_name,
          r.academic_year,
          r.round_number,
          r.round_type,
          NULL AS score,
          NULL AS full_score,
          NULL AS passing_score,
          epr.paper_result
        FROM exam_paper_result epr
        JOIN exam_rounds r ON epr.round_id = r.round_id
        JOIN students st ON epr.std_id = st.std_id
        WHERE st.std_code = ? AND r.round_status = 1
        
        ORDER BY round_type ASC, academic_year ASC, round_number ASC
      `;

      // 🌟 ส่ง stdCode ไป 2 ครั้ง เพราะมีเครื่องหมาย ? 2 จุดใน SQL
      const [history]: any = await conn.query(sql, [stdCode, stdCode]);

      if (history.length === 0) {
        return res.json({
          history: [],
          message: "ไม่พบประวัติการสอบของนิสิตคนนี้",
        });
      }

      return res.json({ history });
    } catch (error) {
      console.error("Fetch Student History Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },
);
