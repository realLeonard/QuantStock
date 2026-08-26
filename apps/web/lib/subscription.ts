// ===== 订阅系统前端常量与工具 =====

/** 微信收款二维码图片路径（apps/web/public/ 下） */
export const WECHAT_QR_SRC = '/wechat-pay-qr.jpg';

/** 支付宝收款二维码图片路径（apps/web/public/ 下） */
export const ALIPAY_QR_SRC = '/alipay-pay-qr.jpg';

/** 手机号校验（与后端 /api/subscribe/order 规则一致） */
export const PHONE_REGEX = /^1[3-9]\d{9}$/;

/** 计算剩余天数（向上取整）；无到期限制返回 null */
export function remainingDays(expiresAt: number | null | undefined): number | null {
  if (expiresAt == null) return null;
  return Math.ceil((expiresAt - Date.now()) / (24 * 3600 * 1000));
}

/** 到期时间格式化为北京时间日期 */
export function formatExpireDate(expiresAt: number): string {
  return new Date(expiresAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
