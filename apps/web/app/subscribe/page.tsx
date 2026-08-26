'use client';

import { useEffect, useState } from 'react';
import { SUBSCRIPTION_PLANS } from '@quantstock/types';
import type { SessionUser, SubscriptionPlan } from '@quantstock/types';
import {
  WECHAT_QR_SRC,
  ALIPAY_QR_SRC,
  PHONE_REGEX,
  remainingDays,
  formatExpireDate,
} from '../../lib/subscription';
import styles from './subscribe.module.css';

const PLAN_KEYS: SubscriptionPlan[] = ['month', 'quarter', 'year'];

export default function SubscribePage() {
  const [plan, setPlan] = useState<SubscriptionPlan>('quarter');
  const [phone, setPhone] = useState('');
  const [phoneLocked, setPhoneLocked] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // 已登录 member 自动带出手机号（用户名即手机号）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('session_user');
      if (!raw) return;
      const user = JSON.parse(raw) as SessionUser;
      setSessionUser(user);
      if (user.role === 'member' && PHONE_REGEX.test(user.username)) {
        setPhone(user.username);
        setPhoneLocked(true);
      }
    } catch {
      // sessionStorage 解析失败视为未登录
    }
  }, []);

  const days = remainingDays(sessionUser?.subscription_expires_at);

  const handleSubmit = async () => {
    setErrorMsg('');
    if (!PHONE_REGEX.test(phone)) {
      setErrorMsg('请输入正确的 11 位手机号');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/backend-api/subscribe/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, plan }),
      });
      const json = (await res.json()) as { data?: { id: string }; error?: string };
      if (!res.ok) {
        setErrorMsg(json.error ?? '提交失败，请稍后再试');
        return;
      }
      setSubmitted(true);
    } catch {
      setErrorMsg('网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.successIcon}>✅</div>
          <h2 className={styles.successTitle}>订单已提交</h2>
          <p className={styles.successText}>
            管理员核对收款后将为您开通订阅
          </p>
          <p className={styles.successHint}>
            开通后使用手机号 <b>{phone}</b> 登录后台即可查看内容，密码将与开通成功短信通知一同发送给您
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>股海远洋 · 会员订阅</h1>
        <p className={styles.subtitle}>
          订阅后可查看掘金、每日早报、复盘、板块预测、投资主题等全部内容
        </p>

        {sessionUser?.role === 'member' && (
          <div className={styles.memberBanner}>
            {sessionUser.subscription_expires_at != null && days != null ? (
              days > 0 ? (
                <>
                  当前订阅至 {formatExpireDate(sessionUser.subscription_expires_at)}
                  ，剩余 <b>{days}</b> 天，续费将在此基础上顺延
                </>
              ) : (
                <>订阅已到期，续费后立即恢复访问</>
              )
            ) : (
              <>当前账号不受订阅限制</>
            )}
          </div>
        )}

        <div className={styles.sectionLabel}>1. 选择套餐（功能会不断升级加量不加价，套餐涨价不会要求补差）</div>
        <div className={styles.plans}>
          {PLAN_KEYS.map((key) => {
            const p = SUBSCRIPTION_PLANS[key];
            return (
              <button
                key={key}
                type="button"
                className={`${styles.planCard} ${plan === key ? styles.planActive : ''}`}
                onClick={() => setPlan(key)}
              >
                <div className={styles.planLabel}>{p.label}</div>
                <div className={styles.planPrice}>
                  ¥<span>{p.price}</span>
                </div>
                <div className={styles.planDays}>{p.days} 天</div>
              </button>
            );
          })}
        </div>

        <div className={styles.sectionLabel}>2. 填写手机号（将作为登录用户名）</div>
        <input
          className={styles.phoneInput}
          type="tel"
          maxLength={11}
          placeholder="请输入 11 位手机号"
          value={phone}
          disabled={phoneLocked}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        />

        <div className={styles.sectionLabel}>3. 扫码付款（付款时，请 添加备注 第2步的手机号）</div>
        <div className={styles.payRow}>
          <div className={styles.qrBox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={WECHAT_QR_SRC} alt="微信收款二维码" className={styles.qrImg} />
            <div className={styles.qrCaption}>微信扫码支付</div>
          </div>
          <div className={styles.qrBox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ALIPAY_QR_SRC} alt="支付宝收款二维码" className={styles.qrImg} />
            <div className={`${styles.qrCaption} ${styles.alipayCaption}`}>支付宝扫码支付</div>
          </div>
        </div>
        <div className={styles.payAmount}>
          应付金额：<b>¥{SUBSCRIPTION_PLANS[plan].price}</b>
        </div>

        {errorMsg && <div className={styles.error}>{errorMsg}</div>}

        <button
          type="button"
          className={styles.submitBtn}
          disabled={submitting}
          onClick={handleSubmit}
        >
          <span className={styles.submitMain}>{submitting ? '提交中…' : '我已付款'}</span>
          <span className={styles.submitSub}>
            付款后点击按钮提交订单，管理员核对收款后为您开通订阅
          </span>
        </button>
      </div>
    </div>
  );
}
