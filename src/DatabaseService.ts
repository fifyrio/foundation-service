import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 定义用户模型接口
interface UserModel {
    user_id: number;
    username: string;
    email: string;
    password: string;
    referral_code: string;    
    created_at: Date;
    updated_at: Date;
    uuid: string;
    login_type: number;
    reward_amount: number;
    avatar: string | null;
}

interface RewardRecordModel {
    reward_record_id: number;
    user_id: number;
    amount: number;
    type: 'Redeemed' | 'Cost' | 'Checkin';
    origin: string;
    created_at: Date;
}

class DatabaseService {
    private connection!: mysql.Connection;

    constructor() {
        this.initializeDB();
    }

    private async initializeDB() {
        this.connection = await mysql.createConnection({
            host: process.env.DB_HOST, // 从环境变量获取
            user: process.env.DB_USER, // 从环境变量获取
            password: process.env.DB_PASSWORD, // 从环境变量获取
            database: process.env.DB_NAME, // 从环境变量获取
        });
    }

    // 创建用户
    public async createUser(userData: {
        username: string;
        email: string | null;
        password: string;
        referral_code: string;        
        uuid: string;
        login_type: number;
        avatar?: string;
        open_id?: string;
    }): Promise<number> {
        const query = `
            INSERT INTO Users (username, email, password, referral_code, uuid, login_type, avatar, open_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                username = VALUES(username),
                ${userData.email!=null ? 'email = VALUES(email),' : ''}                
                password = VALUES(password),
                referral_code = VALUES(referral_code),                
                login_type = VALUES(login_type),
                avatar = VALUES(avatar),
                open_id = VALUES(open_id),
                updated_at = CURRENT_TIMESTAMP
        `;        
        const [result] = await this.connection.execute(query, [
            userData.username,
            userData.email || "",
            userData.password,
            userData.referral_code,            
            userData.uuid,
            userData.login_type,
            userData.avatar || "",
            userData.open_id || ""
        ]);
        return (result as mysql.ResultSetHeader).insertId; // 返回插入的用户ID
    }

    // get user model info by uuid
    public async getUserByUuid(uuid: string): Promise<UserModel | null> {
        const query = `SELECT * FROM Users WHERE uuid = ?`;
        const [rows] = await this.connection.execute(query, [uuid]);
        const users = rows as UserModel[];
        return users.length > 0 ? users[0] : null;
    }

    // 更新用户
    public async updateUser(userId: number, updates: Partial<{
        username: string;
        email: string;
        password: string;
        referral_code: string;        
        uuid: string;
        login_type: number;
        avatar: string;
    }>) {
        const setClause = Object.keys(updates)
            .map(key => `${key} = ?`)
            .join(', ');

        const query = `UPDATE Users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        const values = [...Object.values(updates), userId];
        const [result] = await this.connection.execute(query, values);
        return result;
    }

    // 删除用户
    public async deleteUser(userId: number) {
        const query = `DELETE FROM Users WHERE user_id = ?`;
        const [result] = await this.connection.execute(query, [userId]);
        return result;
    }


    // 创建佣金记录并更新用户积分
    public async createCommission(commissionData: {
        user_id: number;                // 佣金归属用户的 ID
        invited_user_id: number;        // 被邀请用户的 ID
        amount: number;                 // 佣金金额
        status: 'Pending' | 'Completed' | 'Rejected'; // 佣金状态
    }) {
        // 开始事务        
        await this.connection.beginTransaction();

        try {
            // check if Commissions record already exists with the same user_id and invited_user_id
            const checkQuery = `SELECT * FROM Commissions WHERE user_id = ? AND invited_user_id = ?`;
            const [checkResult] = await this.connection.execute(checkQuery, [
                commissionData.user_id,
                commissionData.invited_user_id
            ]);
            const commissions = checkResult as { commission_id: number }[];
            if (commissions.length > 0) {
                return;
            }

            // 1. 插入佣金记录
            const commissionQuery = `INSERT INTO Commissions (user_id, invited_user_id, amount, status) VALUES (?, ?, ?, ?)`;
            const [commissionResult] = await this.connection.execute(commissionQuery, [
                commissionData.user_id,
                commissionData.invited_user_id,
                commissionData.amount,
                commissionData.status
            ]);

            // 从 commissionResult 中获取 insertId
            const insertId = (commissionResult as mysql.ResultSetHeader).insertId;;

            // 2. 更新用户的奖励积分
            const updateUserQuery = `UPDATE Users SET reward_amount = COALESCE(reward_amount, 0) + ? WHERE user_id = ?`;
            await this.connection.execute(updateUserQuery, [
                commissionData.amount,
                commissionData.invited_user_id
            ]);

            // 3. 在 RewardRecords 中插入 Redeemed 记录
            const rewardRecordQuery = `INSERT INTO RewardRecords (user_id, amount, type, origin) VALUES (?, ?, 'Redeemed', ?)`;
            await this.connection.execute(rewardRecordQuery, [
                commissionData.invited_user_id,
                commissionData.amount,                
                "Redeemed by commission"
            ]);

            // 提交事务
            await this.connection.commit();

            return insertId; // 返回新插入佣金记录的 ID
        } catch (error) {
            // 回滚事务
            await this.connection.rollback();
            throw error; // 重新抛出错误
        } 
    }

    // 消费奖励积分, 并在 RewardRecords 中插入 Redeemed 记录, 同时更新Users的reward_amount
    public async costReward(userId: number, amount: number, origin: string) {
        // 开始事务
        await this.connection.beginTransaction();

        try {
            // 1. 更新用户的奖励积分
            const updateUserQuery = `UPDATE Users SET reward_amount = GREATEST(reward_amount - ?, 0) WHERE user_id = ?`;
            await this.connection.execute(updateUserQuery, [
                amount,
                userId
            ]);

            // 2. 在 RewardRecords 中插入 Cost 记录
            const rewardRecordQuery = `INSERT INTO RewardRecords (user_id, amount, type, origin) VALUES (?, ?, 'Cost', ?)`;
            await this.connection.execute(rewardRecordQuery, [
                userId,
                amount,
                origin
            ]);

            // 提交事务
            await this.connection.commit();
        } catch (error) {
            // 回滚事务
            await this.connection.rollback();
            throw error; // 重新抛出错误
        }
    }

    // 签到赠送奖励积分, 并在 RewardRecords 中插入 Checkin 记录, 同时更新Users的reward_amount
    public async checkinReward(userId: number, amount: number) {
        // 开始事务
        await this.connection.beginTransaction();

        try {
            // 1. 更新用户的奖励积分
            const updateUserQuery = `UPDATE Users SET reward_amount = COALESCE(reward_amount, 0) + ? WHERE user_id = ?`;
            await this.connection.execute(updateUserQuery, [
                amount,
                userId
            ]);

            // 2. 在 RewardRecords 中插入 Checkin 记录
            const rewardRecordQuery = `INSERT INTO RewardRecords (user_id, amount, type, origin) VALUES (?, ?, 'Checkin', ?)`;
            await this.connection.execute(rewardRecordQuery, [
                userId,
                amount,
                "Checkin reward"
            ]);

            // 提交事务
            await this.connection.commit();
        } catch (error) {
            // 回滚事务
            await this.connection.rollback();
            throw error; // 重新抛出错误
        }
    }

    // buy Reward Records by user id and amount
    public async buyReward(userId: number, amount: number): Promise<boolean> {
        // 开始事务
        await this.connection.beginTransaction();

        try {
            // 1. 更新用户的奖励积分
            const updateUserQuery = `UPDATE Users SET reward_amount = reward_amount + ? WHERE user_id = ?`;
            await this.connection.execute(updateUserQuery, [
                amount,
                userId
            ]);

            // 2. 在 RewardRecords 中插入 Cost 记录
            const rewardRecordQuery = `INSERT INTO RewardRecords (user_id, amount, type, origin) VALUES (?, ?, 'Buy', ?)`;
            await this.connection.execute(rewardRecordQuery, [
                userId,
                amount,
                "Bought by user"
            ]);

            // 提交事务
            await this.connection.commit();
            return true;
        } catch (error) {
            // 回滚事务
            await this.connection.rollback();
            throw error; // 重新抛出错误
        }
    }


    // get Reward Records by user id
    public async getRewardRecords(userId: number): Promise<RewardRecordModel[]> {
        const query = `SELECT * FROM RewardRecords WHERE user_id = ?`;
        const [rows] = await this.connection.execute(query, [userId]);
        return rows as RewardRecordModel[];
    }

    // Get user Id by referral code
    public async getUserIdByReferralCode(referralCode: string): Promise<number | null> {
        const query = `SELECT user_id FROM Users WHERE referral_code = ?`;
        const [rows] = await this.connection.execute(query, [referralCode]);
        const users = rows as { user_id: number }[];
        return users.length > 0 ? users[0].user_id : null;
    }
}

export default DatabaseService;