/**
 * Demo0 环境连通性测试
 *
 * 用途：验证 Node / 依赖 / API Key 是否都能正常工作。
 *      这不是项目代码，验证通过后可以删除。
 *
 * 运行：npm run check
 */
import "dotenv/config";
import { ChatDeepSeek } from "@langchain/deepseek";

async function main() {
  // 1. 检查环境变量
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("❌ 未找到 DEEPSEEK_API_KEY，请检查 .env 文件");
    process.exit(1);
  }
  if (apiKey === "sk-your-key-here") {
    console.error("❌ DEEPSEEK_API_KEY 还是占位符，请填入真实 key");
    process.exit(1);
  }
  console.log(`✅ 环境变量已加载 (key 长度 ${apiKey.length})`);

  // 2. 调用模型
  const model = new ChatDeepSeek({
    model: "deepseek-flash",
    temperature: 0,
  });

  console.log("⏳ 正在调用 deepseek-flash ...");
  const start = Date.now();

  try {
    const res = await model.invoke("用一句话介绍你自己");
    const ms = Date.now() - start;

    console.log(`✅ 调用成功（${ms}ms）`);
    console.log("--- 模型回复 ---");
    console.log(res.content);
    console.log("----------------");
    console.log("🎉 环境验证通过，可以开始写 Demo0 了");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 调用失败：${msg}`);
    if (msg.includes("Insufficient Balance")) {
      console.error("   → 账户余额不足，需要充值");
    } else if (msg.includes("401") || msg.includes("Unauthorized")) {
      console.error("   → API Key 无效，检查是否填错");
    }
    process.exit(1);
  }
}

main();
