import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 使用一个密钥来签署JWT
const JWT_SECRET = process.env.JWT_SECRET || ""; // 用于签署 JWT 的密钥，请确保密钥保密
const REFRESH_SECRET = process.env.REFRESH_SECRET || ""; // 可选：用于签署 Refresh Token 的密钥

// 定义生成 JWT 的接口
interface Tokens {
    accessToken: string;
    refreshToken: string;
}

// TokenService 类，负责生成和管理 JWT
export default class TokenService {
    private jwtSecret: string;
    private refreshSecret: string;

    constructor(jwtSecret: string = JWT_SECRET, refreshSecret: string = REFRESH_SECRET) {
        this.jwtSecret = jwtSecret;
        this.refreshSecret = refreshSecret;
    }

    // 生成 JWT
    public generateTokens(userId: number): Tokens {
        const accessToken = jwt.sign({ userId }, this.jwtSecret, { expiresIn: '1h' }); // 访问令牌，1小时
        const refreshToken = jwt.sign({ userId }, this.refreshSecret, { expiresIn: '7d' }); // 刷新令牌，7天
        return { accessToken, refreshToken };
    }

    // Check if the token is valid, return bool
    public verifyToken(token: string): boolean {
        try {
            jwt.verify(token, this.jwtSecret);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 刷新令牌
    public refreshTokens(token: string): Tokens | null {
        try {
            const decoded = jwt.verify(token, this.refreshSecret) as { userId: number };
            return this.generateTokens(decoded.userId);
        } catch (error) {
            return null; // 如果刷新令牌无效，返回 null
        }
    }

    public getToken(req: Request): string | null {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7, authHeader.length);
        } else {
            return null;
        }
    }

    public checkToken(req: Request): boolean {
        const token = this.getToken(req);
        if (token != null) {            
            return this.verifyToken(token);
        } else {
            return false;
        }
    }

    // get user id by token
    public getUserIdByToken(req: Request): number | null {
        const token = this.getToken(req);
        if (token != null) {
            const decoded = jwt.verify(token, this.jwtSecret) as { userId: number };
            return decoded.userId;
        } else {
            return null;
        }
    }
}


