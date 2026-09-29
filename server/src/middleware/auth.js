import { getUser } from '../repositories/userRepository.js';

const ROLE_RANK = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

// 경량 인증: 별도 로그인 화면 없이 X-User-Id 헤더로 신원을 식별한다 (확인 필요 절 참고).
// 헤더가 없거나 등록되지 않은 사용자면 req.user는 null — 권한이 필요 없는 대부분의 화면은 그대로 동작하고,
// requireRole이 걸린 화면(명세서 발행·ERP 전송)에서만 막힌다.
export function identifyUser(db) {
  return (req, res, next) => {
    const userId = req.header('X-User-Id');
    req.user = userId ? getUser(db, userId) : null;
    next();
  };
}

// R1-N-06: 명세서 발행·ERP 전송은 운영자(OPERATOR) 이상만 허용
export function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '인증이 필요합니다 (X-User-Id 헤더로 등록된 사용자여야 합니다)' });
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `권한이 부족합니다 (${minRole} 이상 필요, 현재: ${req.user.role})` });
    }
    next();
  };
}
