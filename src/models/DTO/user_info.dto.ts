import { RowDataPacket } from "mysql2";

export interface UserInfoDTO extends RowDataPacket {
    user_id: number;
    role:    string;
    email:   string;
    passwd:  string;
    status:  number;
}
