export const RISK = {
  NORMAL: { label: '一般关注', type: 'info' },
  RECTIFY: { label: '限期整改', type: 'warning' },
  SUSPEND: { label: '暂停使用', type: 'danger' },
  EVACUATE: { label: '紧急转移', type: 'danger' },
};

export const STATUS = {
  PENDING_REVIEW: { label: '待复核', type: 'warning' },
  IN_PLAN: { label: '已出方案', type: 'primary' },
  NOTIFIED: { label: '已告知', type: 'primary' },
  STOPPED: { label: '已停用', type: 'danger' },
  EVACUATED: { label: '已转移', type: 'danger' },
  RECTIFYING: { label: '整改中', type: 'warning' },
  PENDING_ACCEPTANCE: { label: '待销号', type: 'success' },
  ACCEPTANCE_FAILED: { label: '验收不通过', type: 'danger' },
  CLOSED: { label: '已销号', type: 'success' },
  REBOUND: { label: '问题反弹', type: 'danger' },
  REFUSED: { label: '拒绝整改', type: 'info' },
};

export const ITEM_TYPES = {
  REMOVE_ILLEGAL_FLOOR: '拆除违建加层',
  REINFORCE_WALL: '加固承重墙',
  REPAIR_ROOF: '修复屋面',
  EVICT_TENANTS: '清退经营租户',
  SET_WARNING: '设置警示',
  TEMP_RESETTLEMENT: '安排临时安置',
};

export const ITEM_STATUS = {
  PENDING: { label: '待施工', type: 'info' },
  IN_PROGRESS: { label: '施工中', type: 'warning' },
  DONE: { label: '已完成', type: 'success' },
  FAILED: { label: '不合格', type: 'danger' },
};

export const ISSUE_TYPES = {
  FARMER_REFUSE: '农户拒绝整改',
  MATERIAL_SWAP: '施工队偷换材料',
  SUBSIDY_DISPUTE: '补助资格争议',
  RAIN_SEASON: '雨季导致风险加重',
  TENANT_REFUSE: '租户不愿搬离',
  ACCEPTANCE_FAIL: '验收不通过',
  REBOUND: '复查发现问题反弹',
  SNEAK_RETURN: '整改期间擅自返回/偷返经营',
};

export const PERSON_CATEGORY = {
  OWNER: '户主/家庭成员',
  RESIDENT: '常住人员',
  TENANT: '租户',
  OPERATOR: '经营者',
  WORKER: '从业人员',
};

export const PERSON_STATUS = {
  REGISTERED: { label: '待现场核对', type: 'info' },
  RELOCATED: { label: '已确认离开并安置', type: 'success' },
  STAYING: { label: '仍在房屋内', type: 'danger' },
  SNEAK_BACK: { label: '擅自返回', type: 'danger' },
  RETURNED: { label: '准许后安全返回', type: '' },
};

export const AID_STATUS = {
  APPLIED: { label: '待乡镇核定', type: 'warning' },
  APPROVED: { label: '已核定·待销号拨付', type: 'primary' },
  PAID: { label: '已拨付', type: 'success' },
  REJECTED: { label: '不予核定', type: 'danger' },
};

export const LOSS_STATUS = {
  REPORTED: { label: '待乡镇核定', type: 'warning' },
  VERIFIED: { label: '已核定', type: 'success' },
  REJECTED: { label: '不予认定', type: 'danger' },
};

export const RESUMPTION_STATUS = {
  NONE: { label: '未申请', type: 'info' },
  APPLIED: { label: '待乡镇核准', type: 'warning' },
  APPROVED: { label: '已核准复营业', type: 'success' },
  REJECTED: { label: '未核准', type: 'danger' },
};

export const ISSUE_STATUS = {
  OPEN: { label: '待处理', type: 'danger' },
  RESOLVING: { label: '处理中', type: 'warning' },
  RESOLVED: { label: '已办结', type: 'success' },
};

export const STAKEHOLDER_TYPES = {
  OWNER: '户主',
  TENANT: '租户',
  OPERATOR: '经营者',
  ELDER: '老人家庭成员',
  CADRE: '村干部',
};

export const STANCES = {
  SUPPORT: { label: '支持', type: 'success' },
  NEUTRAL: { label: '中立/观望', type: 'info' },
  OPPOSE: { label: '抵触', type: 'danger' },
  UNKNOWN: { label: '态度不明', type: 'info' },
};

export const DIFFICULTY = {
  NONE: '无（不符合补助）',
  LOW_INCOME: '低保户',
  FIVE_GUARANTEE: '五保户',
  DISABLED: '残疾人家庭',
  MONITORING: '防止返贫监测户',
  VETERAN: '优抚对象',
};

export const SUBSIDY_STATUS = {
  DRAFT: { label: '校验未过/补充材料中', type: 'info' },
  SUBMITTED: { label: '待乡镇复核', type: 'warning' },
  APPROVED: { label: '已批准（待销号发放）', type: 'primary' },
  REJECTED: { label: '已驳回', type: 'danger' },
  PAID: { label: '已发放', type: 'success' },
};

export const ROLE_LABELS = {
  GRID_WORKER: '网格员',
  TOWNSHIP_REVIEWER: '乡镇住建人员',
  COUNTY_ADMIN: '县级主管部门',
  FARMER: '农户',
  TEAM: '施工队',
  ACCEPTOR: '验收人员',
};

export const ACTIVITY_KIND = {
  INSPECTION: '巡查',
  REVIEW: '复核',
  NOTICE: '告知',
  EVACUATE: '转移安置',
  PLAN: '施工计划',
  SUBSIDY: '补助',
  MATERIAL: '材料核验',
  CONSTRUCTION: '施工',
  ACCEPTANCE: '验收',
  CLOSE: '销号',
  RECHECK: '复查',
  ISSUE: '异常',
  CONSULT: '协商',
};

export const fmtDate = (s) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—');
export const fmtDay = (s) => (s ? String(s).slice(0, 10) : '—');
