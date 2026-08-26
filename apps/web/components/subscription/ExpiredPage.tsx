'use client';

import { useAppStore } from '@/store';
import { formatExpireDate } from '@/lib/subscription';
import styles from './ExpiredPage.module.css';

export default function ExpiredPage() {
  const { currentUser, logout } = useAppStore();
  const expiresAt = currentUser?.subscription_expires_at;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.icon}>⏰</div>
        <h1 className={styles.title}>订阅已到期</h1>
        <p className={styles.text}>
          {expiresAt != null && <>您的订阅已于 {formatExpireDate(expiresAt)} 到期，</>}
          续费后即可继续查看掘金、每日早报、复盘、板块预测、投资主题等全部内容
        </p>
        <a className={styles.renewBtn} href="/subscribe">立即续费</a>
        <button className={styles.logoutBtn} onClick={logout}>退出登录</button>
      </div>
    </div>
  );
}
