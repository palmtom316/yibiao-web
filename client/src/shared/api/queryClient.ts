import { QueryClient } from '@tanstack/react-query';

// 单例 QueryClient（O09 会话隔离）：main.tsx 用它建立 Provider，auth.tsx 在登出/权限失效时
// 整体清空。项目列表、活跃项目偏好、诊断与作业等查询结果都按账号授权返回，跨账号复用会串数据。
export const queryClient = new QueryClient();
