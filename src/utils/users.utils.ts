import { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { conn } from "../config/connect_db.js";
import { UserInfoDTO } from "../models/DTO/user_info.dto.js";

export async function getUsers(conn: PoolConnection) {
  try {
    const [users] = await conn.query("");
    if (users) {
    }
  } catch (err: any) {}
  return [];
}

export async function getUser(id: number | null, email: string | null) {
  if (id == null && email == null) return [];
  try {
    let sql = "SELECT * FROM users WHERE 1=1";
    const params: any[] = [];
    if (id !== null) {
      sql += " AND user_id = ?";
      params.push(id);
    }
    if (email !== null) {
      sql += " AND email = BINARY ?";
      params.push(email);
    }
    const [users] = await conn.query<UserInfoDTO[]>(sql, params);
    if (users.length === 0) return [];
    return users;
  } catch (err: any) {
    throw new Error(err);
  }
}

export const insertUser = async (userData: {
  email: string;
  passwd: string;
  role: number;
}) => {
  try {
    // Assuming you have a database connection, e.g., from a pool or client
    // Replace with your actual database query method
    const query = "INSERT INTO users (email, passwd, role) VALUES (?, ?, ?)";
    const values = [userData.email, userData.passwd, userData.role];

    // Execute the query and return the result, e.g., the inserted user ID or the user object
    const [result] = await conn.execute<ResultSetHeader>(query, values); // Adjust based on your DB library

    // Return the inserted user or ID
    return { user_id: result.insertId, ...userData };
  } catch (error) {
    console.error("Error inserting user:", error);
    return null;
  }
};
