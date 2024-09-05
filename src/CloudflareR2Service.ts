// 写一个typeScript程序, 使用`node-cloudflare-r2`上传一个图片到cloudflare的R2
import { R2 } from 'node-cloudflare-r2';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

// 替换为你的 R2 配置
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ""; // Cloudflare 账号 ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ""; // 访问密钥 ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ""; // 访问密钥
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ""; // R2 桶名
const R2_ENDPOINT = process.env.R2_ENDPOINT || ""; // R2 端点

export default class CloudflareR2Service {
    private r2Client: R2;
    constructor() {
        this.r2Client =  new R2({
            accountId: R2_ACCOUNT_ID,
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        });
    }

    public async uploadFile(file: Buffer, prefix: String, fileType: String = ".jpeg"): Promise<string|null> {
        const uploadPromises: Promise<any>[] = [];
        const bucket = this.r2Client.bucket(R2_BUCKET_NAME);
        
        const uuid = uuidv4();
        const key = `${prefix}/${uuid}${fileType}`;
        try {
            const uploadStream = await bucket.uploadStream(file, key, undefined, 'image/jpeg');
            console.log(`Successfully uploaded image to ${R2_ENDPOINT}/${key}`);
            return `${R2_ENDPOINT}/${key}`;
        } catch (error) {
            console.log("Error", error);
            return null;
        }

    }
}
