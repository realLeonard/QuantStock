'use client';

import PageHeader from '@/components/ui/PageHeader';

const ROLES = [
  {
    label: '观察者',
    id: 'viewer',
    color: '#64748b',
    bg: '#f8fafc',
    border: '#e2e8f0',
    permissions: [
      '查看仪表盘、主题管理、近期掘金',
      '查看每日早报、每日复盘、今日资讯',
      '查看涨跌家数、板块预测',
    ],
    restricted: [
      '查看股票字典',
      '新增/编辑/删除主题、股票、掘金内容',
      '访问订阅订单',
      '访问 APP 管理、系统管理',
    ],
  },
  {
    label: '编辑者',
    id: 'editor',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    permissions: [
      '观察者的全部查看权限',
      '查看股票字典（概念板块、股票代码）',
      '新增/编辑/删除主题与股票',
      '编辑近期掘金内容',
    ],
    restricted: [
      '访问订阅订单',
      '访问 APP 管理、系统管理',
    ],
  },
  {
    label: '订阅会员',
    id: 'member',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    permissions: [
      '查看仪表盘、主题管理、近期掘金',
      '查看每日早报、每日复盘、今日资讯',
      '查看涨跌家数、板块预测',
      '查看自己的订阅订单并续费',
    ],
    restricted: [
      '查看股票字典',
      '新增/编辑/删除任何内容',
      '访问 APP 管理、系统管理',
    ],
  },
  {
    label: '管理员',
    id: 'admin',
    color: '#7c3aed',
    bg: '#faf5ff',
    border: '#ddd6fe',
    permissions: [
      '全部内容页面的查看与编辑权限',
      '管理全部订阅订单',
      'APP 管理（APP用户、反馈、行为、管理控制）',
      '系统管理（用户管理、角色管理）',
    ],
    restricted: [],
  },
];

export default function RolesView() {
  return (
    <>
      <PageHeader
        title="角色管理"
        desc="系统内置四个固定角色，权限范围不可自定义。订阅会员由用户购买订阅后自动开通，也可在用户管理中手动创建。"
      />

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, marginTop: 8 }}>
        {ROLES.map(role => (
          <div
            key={role.id}
            className="stat-card"
            style={{
              background: role.bg,
              border: `1.5px solid ${role.border}`,
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: '20px 22px',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-block',
                  background: role.color,
                  color: '#fff',
                  borderRadius: 6,
                  padding: '2px 12px',
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 1,
                }}
              >
                {role.label}
              </span>
              <code style={{ color: '#94a3b8', fontSize: 12 }}>{role.id}</code>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>拥有权限</div>
              <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                {role.permissions.map(p => (
                  <li key={p} style={{ fontSize: 13, color: '#334155', marginBottom: 3 }}>{p}</li>
                ))}
              </ul>
            </div>

            {role.restricted.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>无权操作</div>
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {role.restricted.map(p => (
                    <li key={p} style={{ fontSize: 13, color: '#94a3b8', marginBottom: 3 }}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
