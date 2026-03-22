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
      '查看投资主题列表',
      '查看主题概述与股票池',
      '查看股票详细信息',
    ],
    restricted: [
      '新增/编辑/删除主题',
      '新增/编辑/删除股票',
      '访问用户管理',
    ],
  },
  {
    label: '编辑者',
    id: 'editor',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    permissions: [
      '查看投资主题列表',
      '查看主题概述与股票池',
      '新增/编辑/删除主题',
      '新增/编辑/删除股票',
    ],
    restricted: [
      '访问用户管理',
      '访问角色管理',
    ],
  },
  {
    label: '管理员',
    id: 'admin',
    color: '#7c3aed',
    bg: '#faf5ff',
    border: '#ddd6fe',
    permissions: [
      '查看投资主题列表',
      '查看主题概述与股票池',
      '新增/编辑/删除主题',
      '新增/编辑/删除股票',
      '管理系统用户账号',
      '查看角色权限说明',
    ],
    restricted: [],
  },
];

export default function RolesView() {
  return (
    <>
      <PageHeader
        title="角色管理"
        desc="系统内置三个固定角色，权限范围不可自定义。如需调整权限，请联系开发者修改代码。"
      />

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 8 }}>
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
